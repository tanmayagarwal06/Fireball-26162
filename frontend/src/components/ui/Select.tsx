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
        className="w-full border border-outline-variant bg-input px-1.5 py-1 text-body-sm text-on-surface transition-colors focus:border-on-surface focus:outline-none disabled:opacity-50"
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
