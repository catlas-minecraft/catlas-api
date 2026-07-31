import {
  CircleAlertIcon,
  LogInIcon,
  LogOutIcon,
  UserRoundCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import type { CatlasEditor, EditorSnapshot } from "@/lib/editor";

type AuthControlProps = {
  readonly editor: CatlasEditor;
  readonly snapshot: EditorSnapshot;
};

export function AuthControl({ editor, snapshot }: AuthControlProps) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("demo-user");
  const auth = snapshot.auth;
  const isBusy = auth.status === "checking" || auth.status === "authenticating";

  if (auth.status === "authenticated") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Account menu for ${auth.user.username}`}
            size="icon-sm"
            title={`Signed in as ${auth.user.username}`}
            type="button"
            variant="outline"
          >
            <UserRoundCheckIcon data-icon="inline-start" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
            <DropdownMenuItem disabled>
              <UserRoundIcon />
              <span className="truncate">{auth.user.username}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => void editor.logout()} variant="destructive">
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const panelOpen = open || auth.status === "error";

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen && auth.status === "error") void editor.logout();
      }}
      open={panelOpen}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={isBusy ? "Checking session" : "Open sign in menu"}
          disabled={isBusy}
          size="icon-sm"
          title={isBusy ? "Checking session" : "Sign in"}
          type="button"
          variant="outline"
        >
          {isBusy ? (
            <Spinner data-icon="inline-start" />
          ) : auth.status === "error" ? (
            <CircleAlertIcon data-icon="inline-start" />
          ) : (
            <UserRoundIcon data-icon="inline-start" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Developer sign in</PopoverTitle>
          <PopoverDescription>Enter the public ID used to attribute changesets.</PopoverDescription>
        </PopoverHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void editor.login(userId);
          }}
        >
          <FieldGroup className="gap-3">
            <Field data-invalid={auth.status === "error"}>
              <FieldLabel htmlFor="developer-user-id">Public user ID</FieldLabel>
              <Input
                aria-invalid={auth.status === "error"}
                autoFocus
                disabled={isBusy}
                id="developer-user-id"
                onChange={(event) => setUserId(event.target.value)}
                value={userId}
              />
              <FieldDescription>This id is attached to published changesets.</FieldDescription>
              <FieldError>{auth.status === "error" ? auth.message : null}</FieldError>
            </Field>
          </FieldGroup>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setOpen(false);
                if (auth.status === "error") void editor.logout();
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={isBusy || !userId.trim()} type="submit">
              {auth.status === "authenticating" ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <LogInIcon data-icon="inline-start" />
              )}
              {auth.status === "authenticating" ? "Signing in..." : "Create session"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
