import { Toggle } from '../primitives/Toggle'
import { periodMonthSchema, type PeriodMonth } from '../../../shared/types'
import { PERIOD_MODE_OPTIONS, customPeriod, formatPeriodMonth, periodLabel, stepPeriod, withMode, type Period, type PeriodMode } from './period'
import './PeriodPicker.css'

/**
 * The reporting period control: which shape of window, which window, and —
 * on Custom — its two ends.
 *
 * **Why the arrows are not two more presets.** "Last year" and "this year"
 * as options would need one entry per year anyone might ask for. A window
 * plus a step is the same control at every distance, and it is the one that
 * says where you are: the label between the arrows is the window's name, so
 * pressing ‹ four times leaves no doubt what is on screen.
 *
 * The Custom fields are `<input type="month">`. That is the native control
 * for a `YYYY-MM` value, it is keyboard-operable without any wiring here,
 * and its value is exactly the first seven characters of a `PeriodMonth` —
 * so the conversion at this boundary is a suffix, not a parse. A cleared
 * field (the input allows it) leaves the period alone rather than sending a
 * half-window to main.
 */
export function PeriodPicker({ period, onChange, label = 'Reporting period' }: { period: Period; onChange: (period: Period) => void; label?: string }) {
  return (
    <div className="periodpick" role="group" aria-label={label}>
      <Toggle options={PERIOD_MODE_OPTIONS} value={period.mode} onChange={(mode: PeriodMode) => onChange(withMode(period, mode))} aria-label="Period" />
      {period.mode === 'custom' ? (
        <div className="periodpick-custom">
          <MonthField
            label="From"
            value={period.from}
            onChange={(month) => onChange(customPeriod(month, period.to))}
          />
          <span aria-hidden="true">–</span>
          <MonthField label="To" value={period.to} onChange={(month) => onChange(customPeriod(period.from, month))} />
        </div>
      ) : null}
      <div className="periodpick-step">
        <button type="button" aria-label={`Previous period, before ${periodLabel(period)}`} onClick={() => onChange(stepPeriod(period, -1))}>
          ‹
        </button>
        {/* `aria-live`: pressing an arrow changes nothing else on the page
            that announces itself, so the window's new name is the only
            confirmation the press did anything. */}
        <span className="periodpick-label" aria-live="polite">
          {periodLabel(period)}
        </span>
        <button type="button" aria-label={`Next period, after ${periodLabel(period)}`} onClick={() => onChange(stepPeriod(period, 1))}>
          ›
        </button>
      </div>
    </div>
  )
}

function MonthField({ label, value, onChange }: { label: string; value: PeriodMonth; onChange: (month: PeriodMonth) => void }) {
  return (
    <label className="periodpick-month">
      <span>{label}</span>
      <input
        type="month"
        value={value.slice(0, 7)}
        aria-label={`${label} month, currently ${formatPeriodMonth(value)}`}
        onChange={(event) => {
          const parsed = periodMonthSchema.safeParse(`${event.target.value}-01`)
          if (parsed.success) onChange(parsed.data)
        }}
      />
    </label>
  )
}
