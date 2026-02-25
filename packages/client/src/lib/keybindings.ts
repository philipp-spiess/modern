import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { orpc } from "./rpc";

export type Modifier = "ctrl" | "alt" | "shift" | "cmd" | "win" | "meta";

export type Shortcut = {
  keys: { modifiers: Modifier[]; key: string }[];
};

export type Binding = {
  scope: string;
  key: Shortcut;
  command: string;
};

type KeybindingInput = {
  key: string;
  scope?: string;
};

type ParseOptions = {
  platform?: string;
};

const MAC_REGEX = /mac|darwin/i;

function isMacPlatform(platform?: string): boolean {
  if (platform) return MAC_REGEX.test(platform);
  if (typeof navigator !== "undefined") {
    return MAC_REGEX.test(navigator.platform) || MAC_REGEX.test(navigator.userAgent);
  }
  return typeof process !== "undefined" ? MAC_REGEX.test(process.platform) : false;
}

function normalizeModifier(token: string, macOS: boolean): Modifier | null {
  const value = token.toLowerCase();
  if (value === "mod") return macOS ? "cmd" : "ctrl";
  if (value === "cmd" || value === "command") return "cmd";
  if (value === "ctrl" || value === "control") return "ctrl";
  if (value === "alt" || value === "option") return "alt";
  if (value === "shift") return "shift";
  if (value === "win" || value === "meta") return value === "win" ? "win" : "meta";
  return null;
}

export function parseShortcut(input: string, options?: ParseOptions): Shortcut {
  const macOS = isMacPlatform(options?.platform);
  const parts = input.trim().split(/\s+/).filter(Boolean);

  const keys: Shortcut["keys"] = parts.map((part) => {
    const tokens = part.split("+").filter(Boolean);
    const modifiers: Modifier[] = [];
    let key: string | null = null;

    tokens.forEach((token, index) => {
      const normalizedModifier = normalizeModifier(token, macOS);
      if (normalizedModifier) {
        if (!modifiers.includes(normalizedModifier)) {
          modifiers.push(normalizedModifier);
        }
        return;
      }

      if (key === null || index === tokens.length - 1) {
        key = token.toLowerCase();
      }
    });

    return {
      modifiers,
      key: (key ?? tokens[tokens.length - 1] ?? "").toLowerCase(),
    };
  });

  return { keys };
}

function canonicalModifiers(modifiers: Modifier[]): Set<string> {
  const mapped = modifiers.map((modifier) => {
    if (modifier === "cmd" || modifier === "win" || modifier === "meta") return "meta";
    return modifier;
  });
  return new Set(mapped);
}

export function shortcutMatches(
  shortcut: Shortcut,
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  chordIndex = 0,
): boolean {
  const stroke = shortcut.keys[chordIndex];
  if (!stroke) return false;

  const pressed = new Set<string>();
  if (event.ctrlKey) pressed.add("ctrl");
  if (event.altKey) pressed.add("alt");
  if (event.shiftKey) pressed.add("shift");
  if (event.metaKey) pressed.add("meta");

  const expected = canonicalModifiers(stroke.modifiers);
  if (pressed.size !== expected.size) return false;
  for (const modifier of expected) {
    if (!pressed.has(modifier)) return false;
  }

  return event.key.toLowerCase() === stroke.key.toLowerCase();
}

export function toCodemirrorShortcut(shortcut: Shortcut): string | null {
  if (shortcut.keys.length === 0) return null;

  const segments = shortcut.keys.map((stroke) => {
    const modifiers = canonicalModifiers(stroke.modifiers);
    const parts: string[] = [];

    if (modifiers.has("shift")) parts.push("Shift");
    if (modifiers.has("ctrl")) parts.push("Ctrl");
    if (modifiers.has("alt")) parts.push("Alt");
    if (modifiers.has("meta")) parts.push("Mod");

    parts.push(stroke.key.toLowerCase());
    return parts.join("-");
  });

  return segments.join(" ");
}

export function normalizeBindings(
  commands: Array<{ command: string; defaultKeybinding?: KeybindingInput }>,
): Binding[] {
  return commands.flatMap((command) => {
    const keybinding = command.defaultKeybinding;
    if (!keybinding?.key?.trim()) return [];

    return [
      {
        scope: keybinding.scope ?? "global",
        key: parseShortcut(keybinding.key),
        command: command.command,
      },
    ];
  });
}

export function useKeybinding(
  scope: string,
  callback?: (command: string) => void,
  shouldHandle?: (binding: Binding, event: KeyboardEvent) => boolean,
): Binding[] {
  const { data } = useSuspenseQuery(
    orpc.commands.list.experimental_liveOptions({
      context: { cache: true },
      retry: true,
    }),
  );

  const bindings = useMemo(() => {
    const normalized = normalizeBindings((data as any[]) ?? []);
    return normalized.filter((binding) => binding.scope === scope);
  }, [data, scope]);

  const chordRef = useRef<{ binding: Binding; index: number; timer: number | null } | null>(null);

  useEffect(() => {
    if (!callback || bindings.length === 0) return;

    const resetChord = () => {
      const active = chordRef.current;
      if (active?.timer) {
        window.clearTimeout(active.timer);
      }
      chordRef.current = null;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeChord = chordRef.current;
      if (
        activeChord &&
        shortcutMatches(activeChord.binding.key, event, activeChord.index) &&
        (shouldHandle ? shouldHandle(activeChord.binding, event) : true)
      ) {
        event.preventDefault();
        const isFinal = activeChord.index >= activeChord.binding.key.keys.length - 1;
        if (isFinal) {
          resetChord();
          void callback(activeChord.binding.command);
        } else {
          const timer = window.setTimeout(resetChord, 1500);
          chordRef.current = { binding: activeChord.binding, index: activeChord.index + 1, timer };
        }
        return;
      }

      if (activeChord) {
        resetChord();
      }

      for (const binding of bindings) {
        if (shortcutMatches(binding.key, event, 0) && (shouldHandle ? shouldHandle(binding, event) : true)) {
          event.preventDefault();
          if (binding.key.keys.length === 1) {
            void callback(binding.command);
            resetChord();
          } else {
            const timer = window.setTimeout(resetChord, 1500);
            chordRef.current = { binding, index: 1, timer };
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      resetChord();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bindings, callback, shouldHandle]);

  return bindings;
}
