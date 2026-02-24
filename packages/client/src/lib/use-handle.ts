import { useRef, useState, type PointerEvent, type RefObject } from "react";

type HandleOptions = {
  invert?: boolean;
  min?: number;
  max?: number;
  unit?: "px" | "percent";
  containerRef?: RefObject<HTMLElement | null>;
};

export function useHandle(
  orientation: "horizontal" | "vertical",
  _name: string,
  initialSize: number,
  options?: HandleOptions,
) {
  const [value, setValue] = useState(initialSize);

  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ start: number; startValue: number } | null>(null);
  const previousUserSelectRef = useRef<string>("");
  const valueRef = useRef(value);
  const queuedValueRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  valueRef.current = value;

  function clampValue(nextValue: number): number {
    const min = options?.min ?? 0;
    const max = options?.max;
    const clamped = max === undefined ? Math.max(min, nextValue) : Math.max(min, Math.min(max, nextValue));
    return options?.unit === "percent" ? Math.round(clamped * 100) / 100 : Math.round(clamped);
  }

  function flushQueuedValue() {
    if (queuedValueRef.current === null) {
      return;
    }

    const next = queuedValueRef.current;
    queuedValueRef.current = null;

    setValue((current) => (current === next ? current : next));
  }

  function scheduleValue(nextValue: number) {
    queuedValueRef.current = nextValue;

    if (rafIdRef.current !== null) {
      return;
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      flushQueuedValue();
    });
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget !== elementRef.current) {
      return;
    }

    event.preventDefault();

    dragState.current = {
      start: orientation === "horizontal" ? event.clientX : event.clientY,
      startValue: valueRef.current,
    };

    previousUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState.current) {
      return;
    }

    event.preventDefault();

    const current = orientation === "horizontal" ? event.clientX : event.clientY;
    let delta = current - dragState.current.start;

    if (options?.unit === "percent" && options.containerRef?.current) {
      const containerSize =
        orientation === "horizontal"
          ? options.containerRef.current.offsetWidth
          : options.containerRef.current.offsetHeight;
      delta = containerSize > 0 ? (delta / containerSize) * 100 : 0;
    }

    const signedDelta = options?.invert ? -delta : delta;

    scheduleValue(clampValue(dragState.current.startValue + signedDelta));
  }

  function clearDragState() {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    flushQueuedValue();
    dragState.current = null;
    document.body.style.userSelect = previousUserSelectRef.current;
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragState.current) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    clearDragState();
  }

  function onPointerCancel() {
    if (!dragState.current) {
      return;
    }

    clearDragState();
  }

  function onLostPointerCapture() {
    if (!dragState.current) {
      return;
    }

    clearDragState();
  }

  function onDoubleClick() {
    setValue(initialSize);
  }

  return [
    value,
    {
      ref: elementRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onDoubleClick,
    },
  ] as const;
}
