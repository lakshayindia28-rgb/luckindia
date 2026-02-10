import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiFetch } from '@/services/api'
import { formatSlotLabel, SLOT_OPTIONS } from '@/lib/slots'

function todayISO() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function SuperPlayPage() {
  const [vendors, setVendors] = useState([])
  const [vendorUserId, setVendorUserId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [hour, setHour] = useState(String(new Date().getHours()))
  const [quizzes, setQuizzes] = useState([])
  const [locked, setLocked] = useState({ SILVER: false, GOLD: false, DIAMOND: false })
  const [loadingStories, setLoadingStories] = useState(false)
  const [showAddTicket, setShowAddTicket] = useState(false)
  const [ticketGrid, setTicketGrid] = useState({
    SILVER: Array.from({ length: 10 }, () => ''),
    GOLD: Array.from({ length: 10 }, () => ''),
    DIAMOND: Array.from({ length: 10 }, () => ''),
  })
  const [myTickets, setMyTickets] = useState({
    SILVER: Array.from({ length: 10 }, () => 0),
    GOLD: Array.from({ length: 10 }, () => 0),
    DIAMOND: Array.from({ length: 10 }, () => 0),
  })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const [refreshSeq, setRefreshSeq] = useState(0)

  const dateInputRef = useRef(null)

  function openDatePicker() {
    const el = dateInputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      el.showPicker()
    } else {
      el.focus()
    }
  }

  const slotKey = useMemo(() => `${vendorUserId || 'x'}-${date}-${hour}`, [vendorUserId, date, hour])

  useEffect(() => {
    apiFetch('/api/assignments/my-vendors')
      .then((d) => setVendors(d.vendors || []))
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    let cancel = false

    async function loadStoriesAndLocks() {
      if (!vendorUserId) {
        setQuizzes([])
        setLocked({ SILVER: false, GOLD: false, DIAMOND: false })
        setMyTickets({
          SILVER: Array.from({ length: 10 }, () => 0),
          GOLD: Array.from({ length: 10 }, () => 0),
          DIAMOND: Array.from({ length: 10 }, () => 0),
        })
        return
      }

      setLoadingStories(true)
      setErr('')
      try {
        const qs = new URLSearchParams({ date, hour: String(Number(hour)), auto: '1' }).toString()
        const [stories, locks, mine] = await Promise.all([
          apiFetch(`/api/stories/slot?${qs}`),
          apiFetch(
            `/api/plays/lock-status?vendorUserId=${encodeURIComponent(vendorUserId)}&date=${encodeURIComponent(date)}&hour=${encodeURIComponent(hour)}`
          ),
          apiFetch(
            `/api/plays/mine?vendorUserId=${encodeURIComponent(vendorUserId)}&date=${encodeURIComponent(date)}&hour=${encodeURIComponent(hour)}`
          ),
        ])
        if (cancel) return
        setQuizzes(stories.quizzes || [])
        setLocked(locks.locked || { SILVER: false, GOLD: false, DIAMOND: false })

        const nextMy = {
          SILVER: Array.from({ length: 10 }, () => 0),
          GOLD: Array.from({ length: 10 }, () => 0),
          DIAMOND: Array.from({ length: 10 }, () => 0),
        }
        for (const row of mine?.rows || []) {
          const qt = row.quizType
          const n = Number(row.selectedNumber)
          const tk = Number(row.tickets || 0)
          if (!nextMy[qt]) continue
          if (!Number.isInteger(n) || n < 0 || n > 9) continue
          nextMy[qt][n] = tk
        }
        setMyTickets(nextMy)
      } catch (e) {
        if (!cancel) setErr(e.message)
      } finally {
        if (!cancel) setLoadingStories(false)
      }
    }

    if (date && hour !== '') loadStoriesAndLocks()
    return () => {
      cancel = true
    }
  }, [slotKey, refreshSeq])

  async function submitQuiz(qt) {
    setErr('')
    setMsg('')

    if (!vendorUserId) {
      setErr('Select a vendor first.')
      return
    }

    const items = []
    for (let i = 0; i < 10; i++) {
      const raw = String(ticketGrid[qt]?.[i] ?? '').trim()
      if (!raw) continue
      const tk = Number(raw)
      if (!Number.isInteger(tk) || tk <= 0) {
        setErr(`${qt}: tickets must be a positive integer (number ${i})`)
        return
      }
      items.push({ quizType: qt, selectedNumber: i, tickets: tk })
    }

    if (items.length === 0) {
      setErr(`${qt}: add at least 1 ticket in any box.`)
      return
    }

    try {
      await apiFetch('/api/plays/bulk', {
        method: 'POST',
        body: {
          vendorUserId: Number(vendorUserId),
          date,
          hour: Number(hour),
          plays: items,
        },
      })

      setMsg(`${qt}: tickets added (${items.length} selection(s))`)

      setTicketGrid((prev) => ({
        ...prev,
        [qt]: Array.from({ length: 10 }, () => ''),
      }))

      setRefreshSeq((s) => s + 1)
    } catch (e) {
      setErr(e.message)
    }
  }

  function quizPanelDisplayOnly(qt) {
    const q = quizzes.find((x) => x.quizType === qt)
    const isLocked = !!locked[qt]
    const already = myTickets[qt] || Array.from({ length: 10 }, () => 0)

    return (
      <div key={qt} className="h-full rounded-2xl bg-zinc-950/55 ring-1 ring-white/10 backdrop-blur">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">{qt}</div>
            <div
              className={
                isLocked
                  ? 'text-xs text-amber-200 rounded-full bg-amber-500/10 ring-1 ring-amber-400/20 px-2 py-1'
                  : 'text-xs text-emerald-200 rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/20 px-2 py-1'
              }
            >
              {isLocked ? 'LOCKED' : 'OPEN'}
            </div>
          </div>

          {!q ? (
            <div className="text-sm text-zinc-400">Story not set yet for this slot.</div>
          ) : (
            <>
              <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
                <div className="text-xs text-zinc-400">Story</div>
                <div className="mt-2 max-h-44 overflow-y-auto pr-2 text-sm text-zinc-200 whitespace-pre-line leading-relaxed scroll-smooth overscroll-contain">
                  {q.summary}
                </div>
              </div>

              <div className="text-xs text-zinc-400">Titles (0-9)</div>
              <div className="mt-2 max-h-[420px] overflow-y-auto pr-1 scroll-smooth overscroll-contain">
                <div className="space-y-2">
                  {q.titles.map((t, i) => (
                    <div key={i} className="rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-zinc-400">{i}</div>
                        <div className="text-[10px] text-zinc-500">My: {already[i] || 0}</div>
                      </div>
                      <div className="text-sm text-zinc-200">{t}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  function addTicketPanel() {
    return (
      <Card className="bg-zinc-950/55 ring-1 ring-white/12 backdrop-blur">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-300 font-medium">Add Ticket</div>
              <div className="text-xs text-zinc-500">Enter tickets for 0-9 numbers, then click Play for each quiz.</div>
            </div>
            <Button variant="secondary" onClick={() => setShowAddTicket(false)}>
              Close
            </Button>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3 items-stretch">
            {['SILVER', 'GOLD', 'DIAMOND'].map((qt) => {
              const isLocked = !!locked[qt]
              const grid = ticketGrid[qt]

              return (
                <div key={`add-${qt}`} className="h-full rounded-2xl bg-zinc-950/55 ring-1 ring-white/10">
                  <div className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-base font-semibold">{qt}</div>
                      <div
                        className={
                          isLocked
                            ? 'text-xs text-amber-200 rounded-full bg-amber-500/10 ring-1 ring-amber-400/20 px-2 py-1'
                            : 'text-xs text-emerald-200 rounded-full bg-emerald-500/10 ring-1 ring-emerald-400/20 px-2 py-1'
                        }
                      >
                        {isLocked ? 'LOCKED' : 'OPEN'}
                      </div>
                    </div>

                    <div className="text-xs text-zinc-400">0-9 Numbers</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Array.from({ length: 10 }, (_, i) => i).map((i) => (
                        <div key={`${qt}-${i}`} className="rounded-xl bg-white/5 ring-1 ring-white/10 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-zinc-200 font-semibold w-4">{i}</div>
                            <Input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              className="h-7 bg-zinc-950/40 px-2 text-sm"
                              value={grid?.[i] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                setTicketGrid((prev) => {
                                  const next = { ...prev }
                                  next[qt] = [...next[qt]]
                                  next[qt][i] = v
                                  return next
                                })
                              }}
                              disabled={isLocked || !vendorUserId}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <Button disabled={isLocked || !vendorUserId} onClick={() => submitQuiz(qt)}>
                        {isLocked ? 'LOCKED' : `Play (${qt})`}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={isLocked || !vendorUserId}
                        onClick={() =>
                          setTicketGrid((prev) => ({
                            ...prev,
                            [qt]: Array.from({ length: 10 }, () => ''),
                          }))
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-zinc-400">Super</div>
        <div className="text-2xl font-semibold">Play on behalf</div>
      </div>

      <Card className="bg-zinc-950/40 ring-1 ring-white/10">
        <CardContent className="p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="text-xs text-zinc-400">Vendor</div>
              <Select value={vendorUserId} onValueChange={setVendorUserId}>
                <SelectTrigger className="bg-zinc-950/40"><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.username} (#{v.id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-zinc-400">Date</div>
              <Input
                ref={dateInputRef}
                className="bg-zinc-950/40 text-zinc-100 [color-scheme:light] [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-95"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onClick={openDatePicker}
                onFocus={openDatePicker}
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs text-zinc-400">Hour</div>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger className="bg-zinc-950/40"><SelectValue placeholder="Select slot" /></SelectTrigger>
                <SelectContent>
                  {SLOT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs text-zinc-400">Selected Slot</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="rounded-md bg-white/5 px-3 py-2 text-sm text-zinc-200">{date}</div>
                <div className="rounded-md bg-white/5 px-3 py-2 text-sm text-zinc-200">{formatSlotLabel(hour) || '—'}</div>
              </div>
            </div>

            <Button variant="secondary" onClick={() => setShowAddTicket((v) => !v)}>
              {showAddTicket ? 'Hide Add Ticket' : 'Add Ticket'}
            </Button>
          </div>

          {err ? <div className="text-sm text-red-200">{err}</div> : null}
          {msg ? <div className="text-sm text-emerald-200">{msg}</div> : null}
        </CardContent>
      </Card>

      {showAddTicket ? addTicketPanel() : null}

      {!showAddTicket ? (
        <Card className="bg-zinc-950/55 ring-1 ring-white/12 backdrop-blur">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-zinc-300 font-medium">Stories & Picks</div>
                <div className="mt-1 text-xs text-zinc-500">Select vendor + date + hour to view stories.</div>
              </div>
              {loadingStories ? <div className="text-xs text-zinc-500">Loading…</div> : null}
            </div>

            {!vendorUserId ? (
              <div className="mt-3 text-sm text-zinc-400">Select a vendor to view story & titles.</div>
            ) : (
              <div className="mt-3 grid gap-4 lg:grid-cols-3 items-stretch">
                {['SILVER', 'GOLD', 'DIAMOND'].map((qt) => quizPanelDisplayOnly(qt))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
