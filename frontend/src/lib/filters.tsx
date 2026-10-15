import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type FilterState = {
  symbol: string
  strategyId: string
  from: string
  to: string
}

type FiltersContextValue = {
  draft: FilterState
  applied: FilterState
  setDraft: (patch: Partial<FilterState>) => void
  apply: () => void
  /** Set symbol/strategy (and optional patch) and apply immediately. */
  selectAndApply: (patch: Partial<FilterState>) => void
  /** Seed empty filters from discovered strategies/datasets (once). */
  hydrateFromCatalog: (
    strategies: { symbol: string; strategy_id: string }[],
    datasetSymbols: string[],
  ) => void
}

const emptyState: FilterState = {
  symbol: "",
  strategyId: "",
  from: "",
  to: "",
}

const FiltersContext = createContext<FiltersContextValue | null>(null)

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<FilterState>(emptyState)
  const [applied, setApplied] = useState<FilterState>(emptyState)
  const [hydrated, setHydrated] = useState(false)

  const setDraft = useCallback((patch: Partial<FilterState>) => {
    setDraftState((d) => ({ ...d, ...patch }))
  }, [])

  const selectAndApply = useCallback((patch: Partial<FilterState>) => {
    setDraftState((d) => {
      const next = { ...d, ...patch }
      setApplied(next)
      return next
    })
  }, [])

  const hydrateFromCatalog = useCallback(
    (
      strategies: { symbol: string; strategy_id: string }[],
      datasetSymbols: string[],
    ) => {
      if (hydrated) return
      const first =
        strategies[0] ??
        (datasetSymbols[0]
          ? { symbol: datasetSymbols[0], strategy_id: "" }
          : null)
      if (!first) return
      const next: FilterState = {
        symbol: first.symbol,
        strategyId: first.strategy_id,
        from: "",
        to: "",
      }
      setDraftState(next)
      setApplied(next)
      setHydrated(true)
    },
    [hydrated],
  )

  const value = useMemo<FiltersContextValue>(
    () => ({
      draft,
      applied,
      setDraft,
      apply: () => setApplied(draft),
      selectAndApply,
      hydrateFromCatalog,
    }),
    [draft, applied, setDraft, selectAndApply, hydrateFromCatalog],
  )

  return (
    <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>
  )
}

export function useFilters() {
  const ctx = useContext(FiltersContext)
  if (!ctx) throw new Error("useFilters must be used within FiltersProvider")
  return ctx
}
