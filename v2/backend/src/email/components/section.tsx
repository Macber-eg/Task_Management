import React from "react";
import { Section as EmailSection } from "@react-email/components";

type SectionProps = React.ComponentProps<typeof EmailSection>;

export function Section({ align, style, ...props }: SectionProps) {
  return (
    <EmailSection
      {...props}
      align={align}
      style={{ width: "100%", ...style }}
    />
  );
}
