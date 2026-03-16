import type { ActivationFunction } from "vscode-notebook-renderer";

interface PlotlyData {
  data: Array<Record<string, unknown>>;
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface PlotlyLib {
  newPlot: (
    el: HTMLElement,
    data: PlotlyData["data"],
    layout?: PlotlyData["layout"],
    config?: PlotlyData["config"]
  ) => Promise<void>;
  Plots: {
    resize: (el: HTMLElement) => void;
  };
}

const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js";

let plotlyLoaded: Promise<PlotlyLib> | null = null;

function loadPlotly(): Promise<PlotlyLib> {
  if (plotlyLoaded) return plotlyLoaded;

  plotlyLoaded = new Promise<PlotlyLib>((resolve, reject) => {
    // Temporarily remove `define` so Plotly's UMD wrapper doesn't take the
    // AMD/RequireJS path (VS Code's webview exposes a RequireJS-like define).
    // Without this, Plotly registers as an AMD module instead of setting
    // window.Plotly.
    const prevDefine = (window as any).define;
    (window as any).define = undefined;

    const script = document.createElement("script");
    script.src = PLOTLY_CDN;
    script.onload = () => {
      (window as any).define = prevDefine;
      const P = (window as any).Plotly as PlotlyLib | undefined;
      if (P) {
        resolve(P);
      } else {
        reject(new Error("Plotly.js loaded but window.Plotly not set"));
      }
    };
    script.onerror = () => {
      (window as any).define = prevDefine;
      reject(new Error("Failed to load Plotly.js from CDN"));
    };
    document.head.appendChild(script);
  });

  return plotlyLoaded;
}

export const activate: ActivationFunction = (_context) => ({
  async renderOutputItem(outputItem, element) {
    try {
      const Plotly = await loadPlotly();

      const plotlyData: PlotlyData = outputItem.json();
      const container = document.createElement("div");
      container.style.width = "100%";
      container.style.minHeight = "400px";
      element.innerHTML = "";
      element.appendChild(container);

      await Plotly.newPlot(
        container,
        plotlyData.data,
        plotlyData.layout ?? {},
        { responsive: true, ...plotlyData.config }
      );

      const observer = new ResizeObserver(() => {
        Plotly.Plots.resize(container);
      });
      observer.observe(element);
    } catch (err: any) {
      const pre = document.createElement("pre");
      pre.style.cssText =
        "color:#f44;padding:8px;font-size:12px;white-space:pre-wrap;";
      pre.textContent = `Plotly render error: ${err.message}\n${err.stack ?? ""}`;
      element.innerHTML = "";
      element.appendChild(pre);
    }
  },
  disposeOutputItem(_id) {
    // cleanup handled by VS Code removing the element
  },
});
