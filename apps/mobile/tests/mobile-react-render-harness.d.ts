declare const require: (moduleName: string) => any;

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: unknown;
  }

  interface ElementChildrenAttribute {
    children: {};
  }

  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}

declare module "react" {
  export type ReactNode = any;
  export type ComponentProps<T> = T extends (props: infer P) => any ? P : Record<string, unknown>;

  export function useCallback<T extends (...args: any[]) => unknown>(callback: T, deps?: unknown[]): T;
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  export function useState<T>(initialValue: T | (() => T)): [T, (nextValue: T | ((previousValue: T) => T)) => void];
}

declare module "react/jsx-runtime" {
  export const Fragment: symbol;
  export function jsx(type: unknown, props: Record<string, unknown> | null, key?: unknown): any;
  export function jsxs(type: unknown, props: Record<string, unknown> | null, key?: unknown): any;
}

declare module "react-native" {
  export const Modal: (props: Record<string, unknown>) => any;
  export const ScrollView: (props: Record<string, unknown>) => any;
  export const Switch: (props: Record<string, unknown>) => any;
  export const Text: (props: Record<string, unknown>) => any;
  export const TextInput: (props: Record<string, unknown>) => any;
  export const TouchableOpacity: (props: Record<string, unknown>) => any;
  export const View: (props: Record<string, unknown>) => any;
  export function useWindowDimensions(): { width: number; height: number; fontScale: number };
}

declare module "@expo/vector-icons" {
  export const MaterialCommunityIcons: (props: Record<string, unknown>) => any;
}
