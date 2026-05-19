import type { AssistantInterrupt } from "@starlog/contracts";

const assert = require("node:assert/strict");
const Module = require("node:module");
const originalLoad = Module._load;

type RenderNode =
  | null
  | string
  | number
  | ElementNode;

type ElementNode = {
  type: unknown;
  key?: unknown;
  props: Record<string, unknown>;
  children: RenderNode[];
};

const Fragment = Symbol("Fragment");

function createElement(type: unknown, props: Record<string, unknown> | null, key?: unknown): RenderNode {
  return { type, key, props: props || {}, children: [] };
}

function nativeComponent(name: string) {
  return function NativeComponent(props: Record<string, unknown>) {
    return createElement(name, props);
  };
}

Module._load = function mockMobileRenderHarnessDependencies(request: string, parent: unknown, isMain: boolean) {
  if (request === "react") {
    return {
      useEffect: (effect: () => void) => {
        effect();
      },
      useMemo: (factory: () => unknown) => factory(),
      useState: (initialValue: unknown) => [typeof initialValue === "function" ? initialValue() : initialValue, () => undefined],
    };
  }
  if (request === "react/jsx-runtime") {
    return {
      Fragment,
      jsx: createElement,
      jsxs: createElement,
    };
  }
  if (request === "react-native") {
    return {
      Modal: nativeComponent("Modal"),
      ScrollView: nativeComponent("ScrollView"),
      Text: nativeComponent("Text"),
      TouchableOpacity: nativeComponent("TouchableOpacity"),
      View: nativeComponent("View"),
    };
  }
  if (request === "@expo/vector-icons") {
    return {
      MaterialCommunityIcons: nativeComponent("MaterialCommunityIcons"),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function renderNode(node: RenderNode | RenderNode[]): RenderNode | RenderNode[] {
  if (Array.isArray(node)) {
    return node.map(renderNode) as RenderNode[];
  }
  if (node === null || typeof node === "string" || typeof node === "number") {
    return node;
  }
  if (typeof node.type === "function") {
    return renderNode(node.type({ ...node.props, key: node.key }) as RenderNode);
  }
  const children = normalizeChildren(node.props.children).map((child) => renderNode(child) as RenderNode);
  if (node.type === Fragment) {
    return children;
  }
  return {
    ...node,
    props: {
      ...node.props,
      children,
    },
    children,
  };
}

function normalizeChildren(children: unknown): RenderNode[] {
  if (children === undefined || children === null || typeof children === "boolean") {
    return [];
  }
  if (Array.isArray(children)) {
    return children.flatMap(normalizeChildren);
  }
  return [children as RenderNode];
}

function findByTestId(node: RenderNode | RenderNode[], testID: string): ElementNode[] {
  const matches: ElementNode[] = [];
  visit(node, (current) => {
    if (current && typeof current === "object" && !Array.isArray(current) && current.props.testID === testID) {
      matches.push(current);
    }
  });
  return matches;
}

function findByType(node: RenderNode | RenderNode[], type: string): ElementNode[] {
  const matches: ElementNode[] = [];
  visit(node, (current) => {
    if (current && typeof current === "object" && !Array.isArray(current) && current.type === type) {
      matches.push(current);
    }
  });
  return matches;
}

function visit(node: RenderNode | RenderNode[], visitor: (node: RenderNode) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, visitor));
    return;
  }
  visitor(node);
  if (node && typeof node === "object") {
    node.children.forEach((child) => visit(child, visitor));
  }
}

function textContent(node: RenderNode | RenderNode[]): string {
  const parts: string[] = [];
  visit(node, (current) => {
    if (typeof current === "string" || typeof current === "number") {
      parts.push(String(current));
    }
  });
  return parts.join("");
}

function interrupt(overrides: Partial<AssistantInterrupt>): AssistantInterrupt {
  return {
    id: "interrupt-1",
    thread_id: "primary",
    run_id: "run-1",
    status: "pending",
    interrupt_type: "choice",
    tool_name: "choose_morning_focus",
    title: "Choose morning focus",
    body: "Pick the first move.",
    fields: [
      {
        id: "focus",
        kind: "select",
        label: "First move",
        required: true,
        options: [
          { label: "Move project forward", value: "project" },
          { label: "Clear system friction", value: "friction" },
        ],
      },
    ],
    primary_label: "Confirm focus",
    secondary_label: "Later",
    display_mode: "inline",
    recommended_defaults: { focus: "project" },
    metadata: {},
    created_at: "2026-05-19T05:00:00Z",
    ...overrides,
  };
}

try {
  const { MobileDynamicPanelHost } = require("../src/mobile-dynamic-panel-host");
  const { mobileDynamicPanelStates } = require("../src/mobile-assistant-panel-state");

  const palette = {
    accent: "#f3b242",
    muted: "#94a3b8",
    text: "#f8fafc",
  };

  {
    const active = interrupt({ id: "focus-panel", tool_name: "choose_morning_focus" });
    const queued = interrupt({
      id: "conflict-panel",
      tool_name: "resolve_planner_conflict",
      title: "Resolve scheduling conflict",
      display_mode: "sidecar",
      fields: [],
      recommended_defaults: {},
    });
    const renderCalls: Array<{ id: string; values: Record<string, unknown>; hasResolve: boolean }> = [];
    const tree = renderNode(
      MobileDynamicPanelHost({
        interrupts: [active, queued],
        panelStates: mobileDynamicPanelStates([active, queued], { "focus-panel": { focus: "friction" } }),
        palette,
        renderPanel: (panel: AssistantInterrupt, values: Record<string, unknown>, onResolve: () => void) => {
          renderCalls.push({ id: panel.id, values, hasResolve: typeof onResolve === "function" });
          return createElement("RenderedPanel", {
            testID: `rendered-panel-${panel.id}`,
            children: `${panel.title}:${String(values.focus ?? "")}`,
          });
        },
      }),
    );

    assert.equal(findByTestId(tree, "mobile-dynamic-panel-host").length, 1);
    assert.deepEqual(renderCalls, [{ id: "focus-panel", values: { focus: "friction" }, hasResolve: true }]);
    assert.equal(findByTestId(tree, "rendered-panel-focus-panel").length, 1);
    assert.equal(findByTestId(tree, "mobile-dynamic-panel-queued").length, 1);
    assert.match(textContent(tree), /Planner conflict is waiting behind the active decision\./);
  }

  {
    const sheet = interrupt({
      id: "review-sheet",
      tool_name: "grade_review_recall",
      title: "Grade Recall",
      placement: "bottom_sheet",
      display_mode: "inline",
      fields: [],
      recommended_defaults: {},
    });
    const tree = renderNode(
      MobileDynamicPanelHost({
        interrupts: [sheet],
        panelStates: mobileDynamicPanelStates([sheet], {}),
        palette,
        renderPanel: () => createElement("RenderedPanel", { testID: "rendered-panel-sheet" }),
      }),
    );
    const sheetRows = findByTestId(tree, "mobile-dynamic-panel-sheet-row");
    const modals = findByType(tree, "Modal");

    assert.equal(sheetRows.length, 1);
    assert.equal(sheetRows[0].props.accessibilityRole, "button");
    assert.equal(sheetRows[0].props.accessibilityLabel, "Open Review grade sheet");
    assert.equal(findByTestId(tree, "rendered-panel-sheet").length, 0);
    assert.equal(modals.length, 1);
    assert.equal(modals[0].props.visible, false);
  }
} finally {
  Module._load = originalLoad;
}
