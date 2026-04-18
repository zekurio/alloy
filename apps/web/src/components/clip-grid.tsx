export function ClipGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={`grid [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))] gap-5 xl:[grid-template-columns:repeat(6,minmax(0,1fr))] ${className ?? ""}`}
      {...props}
    />
  )
}

export function GameRow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={`grid [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))] gap-4 xl:[grid-template-columns:repeat(6,minmax(0,1fr))] ${className ?? ""}`}
      {...props}
    />
  )
}
