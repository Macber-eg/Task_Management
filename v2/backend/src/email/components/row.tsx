import React from "react";
import { Row as EmailRow } from "@react-email/components";

type RowProps = React.ComponentProps<typeof EmailRow>;

export function Row({ align, style, ...props }: RowProps) {
  return (
    <EmailRow {...props} align={align} style={{ width: "100%", ...style }} />
  );
}
