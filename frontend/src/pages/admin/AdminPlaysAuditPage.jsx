import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiFetch } from '@/services/api'
import { SLOT_OPTIONS, formatHourTime } from '@/lib/slots'

function pad2(n) {
  return String(n).padStart(2, '0')
}

function toLocalIsoDate() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  return `${yyyy}-${mm}-${dd}`
}

const ALL = '__ALL__'

export default function AdminPlaysAuditPage() {
  const [date, setDate] = useState(toLocalIsoDate())
  const [hour, setHour] = useState(ALL)
  const [quizType, setQuizType] = useState(ALL)
  const [vendor, setVendor] = useState('')

  const [deleteFrom, setDeleteFrom] = useState(toLocalIsoDate())
  const [deleteTo, setDeleteTo] = useState(toLocalIsoDate())
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (date) p.set('date', date)
    if (hour !== ALL) p.set('hour', hour)
    if (quizType !== ALL) p.set('quizType', quizType)
    if (vendor.trim()) p.set('vendor', vendor.trim())
    p.set('limit', '200')
    p.set('offset', '0')
    return p
  }, [date, hour, quizType, vendor])

  async function load() {
    setError('')
    setDeleteMsg('')
    setLoading(true)
    try {
      const data = await apiFetch(`/api/plays/audit?${params.toString()}`)
      setRows(data.rows || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e.message || 'Failed to load audit')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  async function onDeleteRange() {
    setError('')
    setDeleteMsg('')
    const ok = window.confirm(`Delete all play logs from ${deleteFrom} to ${deleteTo}? This cannot be undone.`)
    if (!ok) return

    setDeleteBusy(true)
    try {
      const data = await apiFetch('/api/plays/audit/delete-range', {
        method: 'POST',
        body: { fromDate: deleteFrom, toDate: deleteTo },
      })
      setDeleteMsg(`Deleted ${data.deleted || 0} record(s).`)
      await load()
    } catch (e) {
      setError(e.message || 'Failed to delete logs')
    } finally {
      setDeleteBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm text-zinc-400">Audit</div>
        <div className="text-2xl font-semibold">Vendor Plays</div>
        <div className="mt-1 text-sm text-zinc-400">
          Admin can see who played which option, for which time slot, and when.
        </div>
      </div>

      <Card className="bg-zinc-950/40 ring-1 ring-white/10">
        <CardContent className="p-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input
                type="date"
                className="bg-white/5 border-white/15"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Hour</Label>
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger className="bg-white/5 border-white/15">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {SLOT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quiz</Label>
              <Select value={quizType} onValueChange={setQuizType}>
                <SelectTrigger className="bg-white/5 border-white/15">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  <SelectItem value="SILVER">SILVER</SelectItem>
                  <SelectItem value="GOLD">GOLD</SelectItem>
                  <SelectItem value="DIAMOND">DIAMOND</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Vendor (ID or Username)</Label>
              <Input
                className="bg-white/5 border-white/15"
                placeholder="e.g. 12 or rahul"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-white/5 ring-1 ring-white/10 p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Delete Logs by Date</div>
                <div className="text-xs text-zinc-400">Deletes play audit logs (plays) for slots in the selected date range.</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input type="date" className="bg-white/5 border-white/15" value={deleteFrom} onChange={(e) => setDeleteFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input type="date" className="bg-white/5 border-white/15" value={deleteTo} onChange={(e) => setDeleteTo(e.target.value)} />
                </div>
                <Button variant="destructive" onClick={onDeleteRange} disabled={deleteBusy || loading}>
                  {deleteBusy ? 'Deleting…' : 'Delete Logs'}
                </Button>
              </div>
            </div>

            {deleteMsg ? <div className="mt-3 text-sm text-emerald-200">{deleteMsg}</div> : null}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-zinc-400">
              {loading ? 'Loading…' : `${total} record(s)`}
            </div>
            <Button variant="secondary" onClick={load} disabled={loading}>
              Refresh
            </Button>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-200 ring-1 ring-red-500/30">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-2xl ring-1 ring-white/10">
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-zinc-300">
              <tr>
                <th className="px-3 py-2 text-left">Slot</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Quiz</th>
                <th className="px-3 py-2 text-left">Option</th>
                <th className="px-3 py-2 text-right">Tickets</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-left">Placed At</th>
                <th className="px-3 py-2 text-left">Placed By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-black/20">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-zinc-400" colSpan={8}>
                    No plays found for selected filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-white/5">
                    <td className="px-3 py-2 text-zinc-200">
                      {r.slot_date} {formatHourTime(r.slot_hour)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-zinc-100">{r.vendor_username}</div>
                      <div className="text-xs text-zinc-400">#{r.vendor_user_id}</div>
                    </td>
                    <td className="px-3 py-2 text-zinc-200">{r.quiz_type}</td>
                    <td className="px-3 py-2">
                      <div className="text-zinc-100">{r.selected_title || '—'}</div>
                      <div className="text-xs text-zinc-400">Number: {r.selected_number}</div>
                    </td>
                    <td className="px-3 py-2 text-right text-zinc-200">{r.tickets}</td>
                    <td className="px-3 py-2 text-right text-zinc-200">₹{r.total_bet}</td>
                    <td className="px-3 py-2 text-zinc-200">{r.created_at}</td>
                    <td className="px-3 py-2">
                      <div className="text-zinc-100">{r.created_by_username}</div>
                      <div className="text-xs text-zinc-400">{r.created_by_role} #{r.created_by_user_id}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
