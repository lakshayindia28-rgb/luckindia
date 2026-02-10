function pad2(n) {
  return String(n).padStart(2, '0')
}

export function formatHourTime(hour) {
  const h = Number(hour)
  if (!Number.isInteger(h) || h < 0 || h > 23) return ''
  const ampm = h < 12 ? 'AM' : 'PM'
  let hour12 = h % 12
  if (hour12 === 0) hour12 = 12
  return `${pad2(hour12)}:00 ${ampm}`
}

export function formatSlotLabel(hour) {
  const h = Number(hour)
  if (!Number.isInteger(h) || h < 0 || h > 23) return ''
  const next = (h + 1) % 24
  return `${formatHourTime(h)} - ${formatHourTime(next)}`
}

export const SLOT_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: formatSlotLabel(h),
}))
