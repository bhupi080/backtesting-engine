import { createFileRoute } from "@tanstack/react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/symbols/$symbol")({
  component: SymbolStubPage,
})

function SymbolStubPage() {
  const { symbol } = Route.useParams()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Symbol {symbol}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Stub page — detailed symbol view not implemented yet.
      </CardContent>
    </Card>
  )
}
