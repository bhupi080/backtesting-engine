import { createFileRoute } from "@tanstack/react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/compare")({
  component: CompareStubPage,
})

function CompareStubPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compare</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Stub — compare view not implemented yet.
      </CardContent>
    </Card>
  )
}
