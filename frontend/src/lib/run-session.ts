/** Last Simulate / Risk-Reward inputs. Survives leaving the page. */

export type SimulateCommitted = {
  symbol: string
  strategyId: string
  lots: number
  commission: number
  balance: number
  chartTf: number
}

export type SimulateSession = {
  lots: number
  commission: number
  balance: number
  chartTf: number
  timeZone: string
  runKey: number
  committed: SimulateCommitted | null
  activeTab: "overview" | "analytics" | "trades" | "grid"
  fillGroup: "signal" | "barClose"
  sidebarOpen: boolean
}

export type RiskRewardCommitted = SimulateCommitted & {
  atrBar: number
  atrPeriod: number
  tpMult: number
  slMult: number
}

export type RiskRewardSession = {
  lots: number
  commission: number
  balance: number
  chartTf: number
  atrBar: number
  atrPeriod: number
  tpMult: number
  slMult: number
  timeZone: string
  runKey: number
  committed: RiskRewardCommitted | null
  activeTab: "overview" | "analytics" | "trades" | "grid" | "suggestions"
  fillGroup: "signal" | "barClose"
  sidebarOpen: boolean
}

export type SuggestionRange = {
  tpFrom: number
  tpTo: number
  slFrom: number
  slTo: number
}

const simulateSession: SimulateSession = {
  lots: 0.1,
  commission: 7,
  balance: 2000,
  chartTf: 10,
  timeZone: "Europe/Bucharest",
  runKey: 0,
  committed: null,
  activeTab: "overview",
  fillGroup: "barClose",
  sidebarOpen: true,
}

const riskRewardSession: RiskRewardSession = {
  lots: 0.1,
  commission: 7,
  balance: 2000,
  chartTf: 10,
  atrBar: 60,
  atrPeriod: 14,
  tpMult: 2,
  slMult: 1,
  timeZone: "Europe/Bucharest",
  runKey: 0,
  committed: null,
  activeTab: "overview",
  fillGroup: "barClose",
  sidebarOpen: true,
}

const suggestionDraft: SuggestionRange = { tpFrom: 2, tpTo: 3, slFrom: 1, slTo: 2 }
let suggestionRange: SuggestionRange = { ...suggestionDraft }
let suggestionBuilt = false

export function getSimulateSession(): SimulateSession {
  return simulateSession
}

export function saveSimulateSession(patch: Partial<SimulateSession>): void {
  Object.assign(simulateSession, patch)
}

export function getRiskRewardSession(): RiskRewardSession {
  return riskRewardSession
}

export function saveRiskRewardSession(patch: Partial<RiskRewardSession>): void {
  Object.assign(riskRewardSession, patch)
}

export function getSuggestionDraft(): SuggestionRange {
  return suggestionDraft
}

export function getSuggestionRange(): SuggestionRange {
  return suggestionRange
}

export function saveSuggestionDraft(next: SuggestionRange): void {
  Object.assign(suggestionDraft, next)
}

export function saveSuggestionRange(next: SuggestionRange): void {
  suggestionRange = { ...next }
}

export function getSuggestionBuilt(): boolean {
  return suggestionBuilt
}

export function saveSuggestionBuilt(built: boolean): void {
  suggestionBuilt = built
}
