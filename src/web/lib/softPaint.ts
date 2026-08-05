/**
 * Detect environments where large backdrop-filter / heavy shadows are especially
 * expensive (software WebGL / no usable GPU path). Used only for paint tuning.
 */
export function shouldUseSoftPaint(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("experimental-webgl", {
        failIfMajorPerformanceCaveat: true,
      });

    if (!gl || !(gl instanceof WebGLRenderingContext)) {
      return true;
    }

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) {
      return false;
    }

    const renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
    return /SwiftShader|llvmpipe|softpipe|Microsoft Basic Render|Software|mesa offscreen/i.test(
      renderer,
    );
  } catch {
    return true;
  }
}

export function applySoftPaintClass(): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("soft-paint", shouldUseSoftPaint());
}
