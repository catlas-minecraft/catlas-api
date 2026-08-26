import { ark } from "@ark-ui/solid/factory";
import { styled } from "../../../styled-system/jsx";
import { type ComponentProps } from "solid-js";
import { button } from "../../../styled-system/recipes";

const ParkButton = styled(ark.button, button);

export type ButtonProps = ComponentProps<typeof ParkButton>;

export const Button = (props: ButtonProps) => <ParkButton type="button" {...props} />;
