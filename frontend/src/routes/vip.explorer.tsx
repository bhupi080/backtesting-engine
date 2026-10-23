import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ChevronDown, Crown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import {
  getSelectedVipId,
  getVipExplorerAccountId,
  getVipExplorerFillGroup,
  saveSelectedVipId,
  saveVipExplorerAccountId,
  saveVipExplorerFillGroup,
} from "@/lib/run-session"
import { cn } from "@/lib/utils"
import { AccountDialog, VipSuggestions } from "@/routes/vip"

export const Route = createFileRoute("/vip/explorer")({
  component: VipExplorerPage,
})

function startingAccountId(): string | null {
  const saved = getVipExplorerAccountId()
  if (saved) return saved
  const fromVip = getSelectedVipId()
  if (fromVip) saveVipExplorerAccountId(fromVip)
  return fromVip
}

function VipExplorerPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const vipsQ = useQuery({
    queryKey: ["vips"],
    queryFn: api.vips,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const accounts = vipsQ.data ?? []
  const [accountId, setAccountId] = useState(startingAccountId)
  const [accountOpen, setAccountOpen] = useState(false)
  const vip = accounts.find((account) => account.id === accountId) ?? null
  const hasBar = Boolean(vip?.lines.some((line) => line.chart_tf_minutes > 0))
  const [fillGroup, setFillGroup] = useState(getVipExplorerFillGroup)
  const chooseFill = (next: "signal" | "barClose") => {
    setFillGroup(next)
    saveVipExplorerFillGroup(next)
  }
  const chooseAccount = (id: string) => {
    setAccountId(id)
    saveVipExplorerAccountId(id)
    setAccountOpen(false)
  }

  const create = useMutation({
    mutationFn: (label: string) => api.createVip(label),
    onSuccess: async (created) => {
      chooseAccount(created.id)
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })
  const rename = useMutation({
    mutationFn: (body: { id: string; name: string }) => api.updateVip(body.id, { name: body.name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteVip(id),
    onSuccess: async (_data, id) => {
      if (accountId === id) {
        setAccountId(null)
        saveVipExplorerAccountId(null)
      }
      await queryClient.invalidateQueries({ queryKey: ["vips"] })
    },
  })

  return (
    <div className="flex h-[calc(100vh-3.75rem)] min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-background/60">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2 lg:flex-row lg:items-center">
        <button
          type="button"
          onClick={() => setAccountOpen(true)}
          className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-left hover:bg-muted/50"
        >
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold">{vip?.name || "Pick an account"}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {vip ? `${vip.lines.length} ${vip.lines.length === 1 ? "symbol" : "symbols"}` : "VIP account"}
            </p>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
        {hasBar ? (
          <div className="grid w-full shrink-0 grid-cols-2 gap-1.5 sm:ml-auto sm:w-[28rem]">
            <FillCard
              active={fillGroup === "signal"}
              title="At signal"
              tfLabel="0m"
              recommended
              onClick={() => chooseFill("signal")}
            />
            <FillCard
              active={fillGroup === "barClose"}
              title="Bar close"
              tfLabel="per symbol"
              onClick={() => chooseFill("barClose")}
            />
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {vipsQ.isLoading ? null : vip && vip.lines.length > 0 ? (
          <VipSuggestions
            key={vip.id}
            vipId={vip.id}
            lines={vip.lines}
            timeZone="Europe/Bucharest"
            fillGroup={fillGroup}
            fillLabel={fillGroup === "barClose" && hasBar ? "Bar close" : "At signal · 0m"}
            targetsOn={Boolean(vip.account_targets_enabled)}
            accountTp={vip.account_tp_usd ?? 1000}
            accountSl={vip.account_sl_usd ?? 500}
            onApply={(tp, sl) => {
              saveSelectedVipId(vip.id)
              void api
                .updateVip(vip.id, {
                  account_targets_enabled: true,
                  account_tp_usd: tp,
                  account_sl_usd: sl,
                })
                .then(() => queryClient.invalidateQueries({ queryKey: ["vips"] }))
                .then(() => navigate({ to: "/vip" }))
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <Crown className="size-8 text-amber-500/60" />
            <p className="text-sm font-medium">
              {vip ? "This account has no symbols" : "Pick a VIP account"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {vip
                ? "Add symbols on the VIP page. You do not need to run the account before building this table."
                : "Open the account list and choose one. You do not need to run it first."}
            </p>
            {vip ? (
              <Button type="button" onClick={() => void navigate({ to: "/vip" })}>
                Open VIP
              </Button>
            ) : (
              <Button type="button" onClick={() => setAccountOpen(true)}>
                Choose account
              </Button>
            )}
          </div>
        )}
      </div>
      <AccountDialog
        open={accountOpen}
        onOpenChange={setAccountOpen}
        accounts={accounts}
        loading={vipsQ.isLoading}
        error={vipsQ.error instanceof Error ? vipsQ.error : null}
        selectedId={vip?.id ?? null}
        creating={create.isPending}
        deleting={remove.isPending}
        createError={create.error instanceof Error ? create.error.message : undefined}
        onSelect={chooseAccount}
        onCreate={(label) => create.mutate(label)}
        onRename={(id, name) => rename.mutate({ id, name })}
        onDelete={(id, label) => {
          if (window.confirm(`Delete ${label}?`)) remove.mutate(id)
        }}
      />
    </div>
  )
}

function FillCard({
  active,
  title,
  tfLabel,
  recommended = false,
  onClick,
}: {
  active: boolean
  title: string
  tfLabel: string
  recommended?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-2 text-left transition-all",
        active
          ? "border-sky-500/50 bg-sky-500/10 ring-1 ring-sky-500/20"
          : "border-border/80 bg-card/40 hover:bg-muted/40",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
          {title}
          <span className="ml-1 font-mono tabular-nums">· {tfLabel}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {recommended ? (
            <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-semibold tracking-wide text-white uppercase">
              Recommended
            </span>
          ) : null}
          {active ? (
            <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-semibold tracking-wide text-white uppercase">
              On
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
