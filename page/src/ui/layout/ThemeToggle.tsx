import {
  WeatherMoonRegular as Moon,
  WeatherSunnyRegular as Sun,
} from "@fluentui/react-icons";
import { IconAction } from "@molcrafts/ui";
import type React from "react";
import { useTheme } from "@/hooks/useTheme";

export const ThemeToggle: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  const Icon = isDark ? Sun : Moon;
  const nextLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  return <IconAction icon={<Icon />} label={nextLabel} onClick={toggleTheme} />;
};
