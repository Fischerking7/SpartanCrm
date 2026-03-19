import { Button } from "@/components/ui/button";

export type TimeHorizon = "today" | "payPeriod" | "mtd";

interface TimeHorizonSelectorProps {
  value: TimeHorizon;
  onChange: (value: TimeHorizon) => void;
}

const options: { value: TimeHorizon; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "payPeriod", label: "Pay Period" },
  { value: "mtd", label: "MTD" },
];

export function TimeHorizonSelector({ value, onChange }: TimeHorizonSelectorProps) {
  return (
    <div className="flex rounded-md border" data-testid="time-horizon-selector">
      {options.map(opt => (
        <Button
          key={opt.value}
          variant={value === opt.value ? "default" : "ghost"}
          size="sm"
          className={`rounded-none first:rounded-l-md last:rounded-r-md ${value === opt.value ? "" : "border-0"}`}
          onClick={() => onChange(opt.value)}
          data-testid={`button-horizon-${opt.value}`}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
