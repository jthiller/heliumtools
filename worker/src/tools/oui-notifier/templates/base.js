
export function baseEmailTemplate(content, managementUrl) {
  const footer = managementUrl
    ? `<div class="footer">
        <a href="${managementUrl}" style="color: #0ea5e9; text-decoration: none; font-weight: 500;">Manage subscription</a>
      </div>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Helium DC Alerts</title>
  <style>
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.5;
      color: #0f172a;
      margin: 0;
      padding: 24px;
      background-color: #f8fafc;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .container {
      max-width: 520px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
    }
    .header {
      padding: 32px 32px 0;
    }
    .header h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.025em;
    }
    .header .subtitle {
      margin-top: 4px;
      font-size: 15px;
      color: #64748b;
      font-weight: 400;
    }
    .content {
      padding: 24px 32px 32px;
    }
    .footer {
      padding: 16px 32px;
      text-align: center;
      font-size: 13px;
      color: #94a3b8;
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Helium DC Alerts</h1>
      <div class="subtitle">OUI Balance Notification</div>
    </div>
    <div class="content">
      ${content}
    </div>
    ${footer}
  </div>
</body>
</html>
  `;
}
