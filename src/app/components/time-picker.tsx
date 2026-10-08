"use client";

/** Displays a 12-hour clock while keeping the shared HH:mm value in 24-hour format. */
export function TimePicker({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const hour24 = Number(value.slice(0, 2));
  const hour = hour24 % 12 || 12;
  const minute = value.slice(3, 5);
  const period = hour24 >= 12 ? "PM" : "AM";
  function change(nextHour: number, nextMinute: string, nextPeriod: string) {
    const next24 = nextHour % 12 + (nextPeriod === "PM" ? 12 : 0);
    onChange(`${String(next24).padStart(2, "0")}:${nextMinute}`);
  }
  return <fieldset className="form-field time-picker" disabled={disabled}>
    <legend>{label}</legend><div className="time-picker-controls">
      <select required aria-label={`${label}: hora`} value={hour} onChange={event => change(Number(event.target.value), minute, period)}>
        {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
      </select><span aria-hidden="true">:</span>
      <select required aria-label={`${label}: minutos`} value={["00", "15", "30", "45"].includes(minute) ? minute : ""} onChange={event => change(hour, event.target.value, period)}>
        {!["00", "15", "30", "45"].includes(minute) && <option value="" disabled>Elegir</option>}
        {["00", "15", "30", "45"].map(item => <option key={item} value={item}>{item}</option>)}
      </select>
      <select required aria-label={`${label}: AM o PM`} value={period} onChange={event => change(hour, minute, event.target.value)}>
        <option value="AM">AM</option><option value="PM">PM</option>
      </select>
    </div>
  </fieldset>;
}
