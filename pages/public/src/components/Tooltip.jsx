import Tippy from "@tippyjs/react";
import "tippy.js/dist/tippy.css";

export default function Tooltip({ content, children, ...props }) {
  if (!content) return children;
  return (
    <Tippy
      content={content}
      delay={[0, 0]}
      duration={[150, 100]}
      arrow={true}
      {...props}
    >
      {children}
    </Tippy>
  );
}
