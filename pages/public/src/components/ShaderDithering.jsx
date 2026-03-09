import { Dithering } from "@paper-design/shaders-react";

const shaderStyle = { backgroundColor: "#070B0D", width: "100%", height: "100%" };

export default function ShaderDithering({ className = "" }) {
  return (
    <div className={className} aria-hidden="true">
      <Dithering
        speed={0.54}
        shape="warp"
        type="2x2"
        size={3.1}
        scale={0.76}
        colorBack="#00000000"
        colorFront="#0D7490"
        style={shaderStyle}
      />
    </div>
  );
}
