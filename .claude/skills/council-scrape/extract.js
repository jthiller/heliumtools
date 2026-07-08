// Harvest one pass of the #advisory-council DOM into a page-global accumulator.
//
// Paste the whole IIFE into the claude-in-chrome `javascript_tool` and run it
// repeatedly (~2s apart). Each call merges the currently-rendered messages into
// `window.__council.byId`, scrolls the message list to the top to load older
// history, and returns ONLY a small counters object; the harvested messages
// stay on the page so per-call token traffic stays tiny. See SKILL.md for the
// loop, the separate final-dump one-liner, and the post-processing steps.
(() => {
  window.__council = window.__council || { byId: {}, passes: 0, lastMinId: null };
  const H = window.__council;

  // Guard against harvesting the wrong tab: javascript_tool runs against whatever
  // is focused, and a complete:true POST of another channel's messages would make
  // the worker soft-remove every real nomination as "absent". Refuse if we're not
  // on the council channel.
  const COUNCIL_CHANNEL_ID = '1524096173206536242';
  if (!location.pathname.includes('/' + COUNCIL_CHANNEL_ID)) {
    return JSON.stringify({ error: 'wrong channel', href: location.href });
  }

  const list = document.querySelector('ol[data-list-id="chat-messages"]');
  if (!list) return JSON.stringify({ error: 'message list not found', href: location.href });

  // Find the scroller structurally (nearest scrollable ancestor) rather than by
  // hashed class name. Discord's generated class names churn, id prefixes don't.
  let scroller = list.parentElement;
  while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement;

  // Text of a message body: keep custom-emoji alt text, drop the "(edited)" TIME badge.
  const textOf = (node) => {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
      else if (n.nodeName === 'IMG') out += n.getAttribute('alt') || '';
      else if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === 'TIME') return;
        out += textOf(n);
      }
    });
    return out;
  };

  // postedAt from the snowflake, never the rendered time element: it is exact and
  // present even on grouped messages (which have no timestamp row of their own).
  const snowflakeMs = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

  // editedAt: exact time if the badge carries <time datetime>; -1 sentinel when an
  // edited badge is present but timeless (converted to null before POST); otherwise
  // inherit whatever we already knew for this id.
  const computeEditedAt = (li, editedTime, prev) => {
    if (editedTime && editedTime.dateTime) return Date.parse(editedTime.dateTime);
    if (li.querySelector('[class*="edited"]')) return prev.editedAt != null ? prev.editedAt : -1;
    return prev.editedAt || null;
  };

  let inDom = 0;
  for (const li of list.querySelectorAll('li[id^="chat-messages-"]')) {
    const id = li.id.split('-').pop();
    if (!/^\d{15,20}$/.test(id)) continue;

    // System messages (joins, pins, boosts) are kept flagged so they can be
    // dropped in the final dump without breaking reply-chain lookups.
    if (li.querySelector('[class*="systemMessage"]')) {
      H.byId[id] = { id, system: true };
      continue;
    }

    const contentEl = li.querySelector('div[id="message-content-' + id + '"]');
    const nameEl = li.querySelector('h3 [class*="username"]');
    const avatarEl = li.querySelector('img[class*="avatar"]');
    const src = avatarEl ? avatarEl.src : null;
    // authorId rides in the avatar URL; default avatars (discord.com/assets/*) carry none.
    const uid = src && (src.match(/\/avatars\/(\d{15,20})\//) || src.match(/\/users\/(\d{15,20})\//));
    const replyPreview = li.querySelector('#message-reply-context-' + id + ' [id^="message-content-"]');
    const editedTime = li.querySelector('[class*="edited"] time');

    const reactions = [];
    for (const pill of li.querySelectorAll('[class*="reactions"] [class*="reaction_"]')) {
      const img = pill.querySelector('img');
      const emoji = img ? (img.alt || '') : '';
      const countEl = pill.querySelector('[class*="reactionCount"]');
      const aria = pill.getAttribute('aria-label')
        || (pill.querySelector('[aria-label]') && pill.querySelector('[aria-label]').getAttribute('aria-label'))
        || '';
      // Anchor to the "N reaction(s)" phrase — a bare \d+ would grab a digit from a
      // custom-emoji name (e.g. "LF5G, 3 reactions" → 5 instead of 3).
      const m = aria.match(/(\d+)\s*reaction/);
      const count = countEl ? parseInt(countEl.textContent, 10) : parseInt(m ? m[1] : '1', 10);
      if (emoji) reactions.push({ emoji, count: count || 1 });
    }

    // Grouped messages (a consecutive-author li with no h3) render no author or
    // avatar, so leave those fields null here and patch them post-harvest by
    // inheriting from the nearest earlier message. Falling back to `prev` also
    // lets a re-render that lost a field keep the value we saw on an earlier pass.
    const prev = H.byId[id] || {};
    H.byId[id] = {
      id,
      postedAt: snowflakeMs(id),
      content: contentEl ? textOf(contentEl).trim() : (prev.content || ''),
      authorDisplayName: nameEl ? nameEl.textContent.trim() : (prev.authorDisplayName || null),
      authorId: uid ? uid[1] : (prev.authorId || null),
      avatarUrl: src ? src.split('?')[0] : (prev.avatarUrl || null),
      replyToId: replyPreview ? replyPreview.id.replace('message-content-', '') : (prev.replyToId || null),
      editedAt: computeEditedAt(li, editedTime, prev),
      reactions: reactions.length ? reactions : (prev.reactions || []),
    };
    inDom++;
  }

  // Terminate when the channel-intro block is on screen; minIdStable is the
  // locale-independent backstop (see SKILL.md loop-termination rules).
  const atTop = /This is the start of/i.test((list.parentElement && list.parentElement.textContent || '').slice(0, 3000));
  const ids = Object.keys(H.byId)
    .filter((k) => !H.byId[k].system)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
  const minId = ids.length ? ids[0] : null;
  const minIdStable = minId !== null && minId === H.lastMinId;
  H.lastMinId = minId;

  if (!atTop && scroller) scroller.scrollTop = 0;

  return JSON.stringify({ pass: ++H.passes, inDom, total: ids.length, minId, atTop, minIdStable, href: location.href });
})();
