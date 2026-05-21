import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select items…",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggle = (v: string) => {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  };

  const clear = () => onChange([]);

  const selectedLabels = value
    .map((v) => options.find((o) => o.value === v)?.label)
    .filter(Boolean) as string[];

  const triggerText =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? selectedLabels[0]
        : `${value.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-[200px] justify-between px-3 font-normal",
            className,
          )}
        >
          <span className="truncate">{triggerText}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <div className="max-h-60 overflow-auto p-1">
          {options.length === 0 && (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No options
            </div>
          )}
          {options.map((option) => {
            const checked = value.includes(option.value);
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
                  checked && "bg-accent/50",
                )}
                onClick={(e) => {
                  e.preventDefault();
                  toggle(option.value);
                }}
              >
                <Checkbox checked={checked} className="pointer-events-none" />
                <span className="flex-1 truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
        {value.length > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={clear}
            >
              <X className="mr-1 h-3 w-3" />
              Clear all
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
