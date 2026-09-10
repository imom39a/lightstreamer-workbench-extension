import { useId, type JSX, type KeyboardEvent } from "react";

import "./filter-value-control.css";

export type FilterValueState = "off" | "include" | "exclude";

export type FilterValueControlProps = Readonly<{
  label: string;
  state: FilterValueState;
  onChange(state: FilterValueState): void;
  disabled?: boolean;
}>;

/** A native single-choice control for one exact Filter value. */
export function FilterValueControl({
  label,
  state,
  onChange,
  disabled = false
}: FilterValueControlProps): JSX.Element {
  const groupId = useId();
  const choices = ["off", "include", "exclude"] as const;
  const moveChoice = (event: KeyboardEvent<HTMLInputElement>, choice: FilterValueState) => {
    const current = choices.indexOf(choice);
    const next = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? choices[(current + 1) % choices.length]
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? choices[(current + choices.length - 1) % choices.length]
        : event.key === "Home"
          ? choices[0]
          : event.key === "End"
            ? choices[choices.length - 1]
            : null;
    if (!next) return;
    event.preventDefault();
    onChange(next);
    window.requestAnimationFrame(() => document.getElementById(`${groupId}-${next}`)?.focus());
  };
  return <fieldset className="workbench-filter-value-control" role="radiogroup" aria-label={label} disabled={disabled}>
    <legend className="workbench-filter-value-control__legend">{label}</legend>
    {choices.map((choice) => {
      const inputId = `${groupId}-${choice}`;
      return <label className="workbench-filter-value-control__choice" data-state={choice} key={choice} htmlFor={inputId}>
        <input
          id={inputId}
          type="radio"
          name={groupId}
          checked={state === choice}
          onChange={() => onChange(choice)}
          onKeyDown={(event) => moveChoice(event, choice)}
        />
        <span>{choice === "off" ? "Off" : choice === "include" ? "Include" : "Exclude"}</span>
      </label>;
    })}
  </fieldset>;
}
