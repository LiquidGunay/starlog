"use client";

type PaneRestoreAction = {
  id: string;
  label: string;
  onClick: () => void;
};

type PaneToggleButtonProps = {
  label: string;
  onClick: () => void;
  className?: string;
};

type PaneRestoreStripProps = {
  actions: PaneRestoreAction[];
  className?: string;
};

export function PaneToggleButton({ label, onClick, className = "" }: PaneToggleButtonProps) {
  return (
    <button className={className ? `pane-toggle-button ${className}` : "pane-toggle-button"} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

export function PaneRestoreStrip({ actions, className = "" }: PaneRestoreStripProps) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className={className ? `pane-restore-strip ${className}` : "pane-restore-strip"}>
      {actions.map((action) => (
        <button key={action.id} className="pane-restore-button" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  );
}
