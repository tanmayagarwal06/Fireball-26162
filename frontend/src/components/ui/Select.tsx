/**
 * Dense select control.
 *
 * Dark fill, 1px border, square corners, white border on focus — per DESIGN.md.
 * Values are encoded to strings and decoded on change so callers can bind
 * numbers and nulls directly without writing conversion glue each time.
 */
import { useId } from 'react';

export interface SelectOption<T> {
  label: string;
  value: T;
  disabled?: boolean;
}

export interface SelectProps<T> {
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Rendered when there are no options, e.g. before the dataset loads. */
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Accessible name when no visible label is rendered. */
  ariaLabel?: string;
}

export function Select<T>({
  label,
  value,
  options,
  onChange,
  emptyLabel = 'No options available',
  disabled = false,
  className,
  ariaLabel,
}: SelectProps<T>) {
  const id = useId();
  const isEmpty = options.length === 0;

  // Index-based encoding keeps arbitrary value types (null, number, string) intact.
  const selectedIndex = options.findIndex((option) => option.value === value);

  return (
    <div className={`flex min-w-0 flex-col gap-1${className ? ` ${className}` : ''}`}>
      {label ? (
        <label className="text-label uppercase text-on-surface-variant" htmlFor={id}>
          {label}
        </label>
      ) : null}

      <select
        aria-label={ariaLabel ?? label}
        className="w-full appearance-none rounded-[var(--radius-sm)] border border-outline-strong bg-input bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23a6a6ae%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-[length:12px_12px] bg-[position:right_8px_center] bg-no-repeat py-1.5 pl-2.5 pr-7 text-body-sm text-on-surface hover:border-outline disabled:opacity-50"
        disabled={disabled || isEmpty}
        id={id}
        onChange={(event) => {
          const index = Number(event.target.value);
          const option = options[index];
          if (option) onChange(option.value);
        }}
        value={selectedIndex >= 0 ? String(selectedIndex) : ''}
      >
        {isEmpty ? <option value="">{emptyLabel}</option> : null}
        {options.map((option, index) => (
          <option disabled={option.disabled} key={option.label} value={String(index)}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
