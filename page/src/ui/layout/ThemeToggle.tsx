import { Moon, Sun } from "lucide-react";
import type React from "react";
import { ViewerIconAction } from "@/components/viewer/ViewerIconAction";
import { useTheme } from "@/hooks/useTheme";

export const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  const Icon = isDark ? Sun : Moon;
  const nextLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <ViewerIconAction icon={<Icon />} label={nextLabel} onClick={toggleTheme} />
  );
};
