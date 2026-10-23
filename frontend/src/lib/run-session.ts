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

let riskExplorerFillGroup: "signal" | "barClose" = "signal"
let vipExplorerFillGroup: "signal" | "barClose" = "signal"
let vipExplorerAccountId: string | null = null

export type VipExplorerRange = {
  tpFrom: number
  tpTo: number
  slFrom: number
  slTo: number
  step: number
}

type VipExplorerBuild = {
  draft: VipExplorerRange
  built: VipExplorerRange | null
}

const vipExplorerBuilds = new Map<string, VipExplorerBuild>()

function emptyVipExplorerBuild(): VipExplorerBuild {
  return {
    draft: { tpFrom: 500, tpTo: 1000, slFrom: 100, slTo: 400, step: 100 },
    built: null,
  }
}

export function getVipExplorerBuild(vipId: string): VipExplorerBuild {
  return vipExplorerBuilds.get(vipId) ?? emptyVipExplorerBuild()
}

export function saveVipExplorerBuild(vipId: string, build: VipExplorerBuild): void {
  vipExplorerBuilds.set(vipId, {
    draft: { ...build.draft },
    built: build.built ? { ...build.built } : null,
  })
}
let riskExplorerSymbol = ""
let riskExplorerStrategy = ""
let riskExplorerChartTf = 10
let riskExplorerLots = 0.1
let riskExplorerCommission = 7
let riskExplorerAtrBar = 60
let riskExplorerAtrPeriod = 14

export function getRiskExplorerFillGroup(): "signal" | "barClose" {
  return riskExplorerFillGroup
}

export function saveRiskExplorerFillGroup(fillGroup: "signal" | "barClose"): void {
  riskExplorerFillGroup = fillGroup
}

export function getVipExplorerFillGroup(): "signal" | "barClose" {
  return vipExplorerFillGroup
}

export function saveVipExplorerFillGroup(fillGroup: "signal" | "barClose"): void {
  vipExplorerFillGroup = fillGroup
}

export function getVipExplorerAccountId(): string | null {
  return vipExplorerAccountId
}

export function saveVipExplorerAccountId(id: string | null): void {
  vipExplorerAccountId = id
}

export function getRiskExplorerPick(): { symbol: string; strategyId: string } {
  return { symbol: riskExplorerSymbol, strategyId: riskExplorerStrategy }
}

export function saveRiskExplorerPick(symbol: string, strategyId: string): void {
  riskExplorerSymbol = symbol
  riskExplorerStrategy = strategyId
}

export function getRiskExplorerChartTf(): number {
  return riskExplorerChartTf
}

export function saveRiskExplorerChartTf(minutes: number): void {
  riskExplorerChartTf = minutes
}

export function getRiskExplorerLots(): number {
  return riskExplorerLots
}

export function saveRiskExplorerLots(lots: number): void {
  riskExplorerLots = lots
}

export function getRiskExplorerCommission(): number {
  return riskExplorerCommission
}

export function saveRiskExplorerCommission(commission: number): void {
  riskExplorerCommission = commission
}

export function getRiskExplorerAtrBar(): number {
  return riskExplorerAtrBar
}

export function saveRiskExplorerAtrBar(minutes: number): void {
  riskExplorerAtrBar = minutes
}

export function getRiskExplorerAtrPeriod(): number {
  return riskExplorerAtrPeriod
}

export function saveRiskExplorerAtrPeriod(period: number): void {
  riskExplorerAtrPeriod = period
}

let selectedVipId: string | null = null

export function getSelectedVipId(): string | null {
  return selectedVipId
}

export function saveSelectedVipId(id: string | null): void {
  selectedVipId = id
}
