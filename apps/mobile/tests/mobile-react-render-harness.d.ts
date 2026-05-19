declare const require: (moduleName: string) => any;

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: unknown;
  }

  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}

declare module "react" {
  export type ReactNode = unknown;
  export type ComponentProps<T> = T extends (props: infer P) => unknown ? P : Record<string, unknown>;

  export function useCallback<T extends (...args: any[]) => unknown>(callback: T, deps?: unknown[]): T;
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  export function useState<T>(initialValue: T | (() => T)): [T, (nextValue: T | ((previousValue: T) => T)) => void];
}

declare module "react/jsx-runtime" {
  export const Fragment: symbol;
  export function jsx(type: unknown, props: Record<string, unknown> | null, key?: unknown): unknown;
  export function jsxs(type: unknown, props: Record<string, unknown> | null, key?: unknown): unknown;
}

declare module "react-native" {
  export const Modal: (props: Record<string, unknown>) => unknown;
  export const ScrollView: (props: Record<string, unknown>) => unknown;
  export const Text: (props: Record<string, unknown>) => unknown;
  export const TextInput: (props: Record<string, unknown>) => unknown;
  export const TouchableOpacity: (props: Record<string, unknown>) => unknown;
  export const View: (props: Record<string, unknown>) => unknown;
}

declare module "@expo/vector-icons" {
  export const MaterialCommunityIcons: (props: Record<string, unknown>) => unknown;
}
