import { useRef, useState, type PointerEvent } from "react";

export function useHandle(orientation: "horizontal" | "vertical", _name: string, initialSize: number) {
  const [value, setValue] = useState(initialSize);

  const elementRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ start: number; startValue: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!target || target !== elementRef.current) {
      return;
    }

    dragState.current = {
      start: orientation === "horizontal" ? event.clientX : event.clientY,
      startValue: value,
    };

    target.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState.current) {
      return;
    }

    const newValue =
      orientation === "horizontal"
        ? Math.round(dragState.current.startValue - (dragState.current.start - event.clientX))
        : Math.round(dragState.current.startValue - (event.clientY - dragState.current.start));

    setValue(Math.max(0, newValue));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragState.current) {
      return;
    }

    event.currentTarget.releasePointerCapture(event.pointerId);
    dragState.current = null;
  }

  function onDoubleClick() {
    setValue(initialSize);
  }

  return [value, { ref: elementRef, onPointerDown, onPointerMove, onPointerUp, onDoubleClick }] as const;
}
