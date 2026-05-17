import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import calculatorHtml from "../fba-calculator.html?raw";

export const Route = createFileRoute("/fba-calculator")({
  head: () => ({
    meta: [
      { title: "FBA Prep Cost Calculator — Ascend FBA" },
      {
        name: "description",
        content:
          "Transparent per-unit Amazon FBA prep pricing. Pick your monthly volume tier and get an instant quote.",
      },
      { property: "og:title", content: "FBA Prep Cost Calculator — Ascend FBA" },
      {
        property: "og:description",
        content:
          "Transparent per-unit Amazon FBA prep pricing. Pick your monthly volume tier and get an instant quote.",
      },
    ],
  }),
  component: CalculatorPage,
});

function CalculatorPage() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1600);

  useEffect(() => {
    let frameObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let rafId = 0;

    const updateHeightFromIframe = () => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const body = doc?.body;
      const html = doc?.documentElement;
      if (!body || !html) return;
      const nextHeight = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.scrollHeight,
        html.offsetHeight,
      );
      if (nextHeight > 0) {
        setHeight((current) => (Math.abs(current - nextHeight) > 2 ? nextHeight + 4 : current));
      }
    };

    const scheduleIframeMeasure = () => {
      cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(updateHeightFromIframe);
    };

    const attachIframeWatchers = () => {
      frameObserver?.disconnect();
      mutationObserver?.disconnect();
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const body = doc?.body;
      if (!body) return;
      updateHeightFromIframe();
      if (window.ResizeObserver) {
        frameObserver = new ResizeObserver(() => scheduleIframeMeasure());
        frameObserver.observe(body);
      }
      mutationObserver = new MutationObserver(() => scheduleIframeMeasure());
      mutationObserver.observe(body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    };

    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (
        data &&
        typeof data === "object" &&
        data.type === "ascend-fba-calc:height" &&
        typeof data.height === "number"
      ) {
        setHeight(Math.ceil(data.height) + 4);
      }
    }

    const iframe = iframeRef.current;
    iframe?.addEventListener("load", attachIframeWatchers);
    window.addEventListener("message", onMessage);
    scheduleIframeMeasure();

    return () => {
      iframe?.removeEventListener("load", attachIframeWatchers);
      window.removeEventListener("message", onMessage);
      frameObserver?.disconnect();
      mutationObserver?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={calculatorHtml}
      title="FBA Prep Cost Calculator"
      scrolling="no"
      style={{
        width: "100%",
        height: `${height}px`,
        border: "0",
        display: "block",
        overflow: "hidden",
      }}
    />
  );
}