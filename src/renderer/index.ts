import type { RendererContext } from "vscode-notebook-renderer";

interface PlotlyData {
  data: Array<Record<string, unknown>>;
  layout?: Record<string, unknown>;
}

declare const Plotly: {
  newPlot: (
    el: HTMLElement,
    data: PlotlyData["data"],
    layout?: PlotlyData["layout"],
    config?: Record<string, unknown>
  ) => Promise<void>;
  Plots: {
    resize: (el: HTMLElement) => void;
  };
};

let plotlyLoaded: Promise<void> | null = null;

function loadPlotly(): Promise<void> {
  if (plotlyLoaded) return plotlyLoaded;

  plotlyLoaded = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-2.35.2.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Plotly.js"));
    document.head.appendChild(script);
  });

  return plotlyLoaded;
}

export async function activate(context: RendererContext<void>) {
  context.onDidCreateOutput(async (event) => {
    const { element, output, signal } = event;

    await loadPlotly();

    const data: PlotlyData = output.json();
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.minHeight = "400px";
    element.appendChild(container);

    await Plotly.newPlot(container, data.data, data.layout ?? {}, {
      responsive: true,
    });

    const observer = new ResizeObserver(() => {
      Plotly.Plots.resize(container);
    });
    observer.observe(element);

    signal?.addEventListener("abort", () => {
      observer.disconnect();
    });
  });
}
