import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { EditorWorkspace } from "./app";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./components/ui/field";
import { Input } from "./components/ui/input";
import { Spinner } from "./components/ui/spinner";
import {
  createSession,
  createWorld,
  deleteSession,
  getSession,
  getWorld,
  listWorlds,
  validWorldSlug,
} from "./lib/world-api";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <NotFound />,
});
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorldHome,
});
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/worlds/$worldSlug",
  component: WorldRoute,
});
const routeTree = rootRoute.addChildren([indexRoute, editorRoute]);

export const router = createRouter({ routeTree });

function WorldHome() {
  const worlds = useQuery({ queryKey: ["worlds"], queryFn: listWorlds });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header>
        <p className="text-sm text-muted-foreground">Catlas</p>
        <h1 className="text-3xl font-semibold tracking-tight">Worlds</h1>
        <p className="mt-2 text-muted-foreground">Choose a world to edit or create a new one.</p>
      </header>
      {worlds.isLoading ? <Loading label="Loading worlds" /> : null}
      {worlds.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{worlds.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {worlds.isSuccess ? <WorldList worlds={worlds.data} /> : null}
      <WorldCreateForm />
    </main>
  );
}

function WorldList({ worlds }: { readonly worlds: Awaited<ReturnType<typeof listWorlds>> }) {
  if (worlds.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No worlds yet</EmptyTitle>
          <EmptyDescription>Create the first public world after signing in.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {worlds.map((world) => (
        <Link
          className="rounded-xl border p-4 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          key={world.id}
          params={{ worldSlug: world.slug }}
          to="/worlds/$worldSlug"
        >
          <strong className="block">{world.name}</strong>
          <span className="text-sm text-muted-foreground">{world.slug}</span>
        </Link>
      ))}
    </div>
  );
}

function WorldCreateForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ["session"], queryFn: getSession });
  const [userId, setUserId] = useState("demo-user");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const slugInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: createWorld,
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : "Could not create world."),
    onSuccess: (world) => {
      void queryClient.invalidateQueries({ queryKey: ["worlds"] });
      void navigate({ to: "/worlds/$worldSlug", params: { worldSlug: world.slug } });
    },
  });

  if (session.isLoading) return <Loading label="Checking session" />;

  const signedIn = Boolean(session.data?.user);
  const signIn = async () => {
    setFormError(null);
    try {
      await createSession(userId.trim());
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not sign in.");
    }
  };
  const signOut = async () => {
    setFormError(null);
    try {
      await deleteSession();
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not sign out.");
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitAttempted(true);
    const normalizedName = name.trim();
    const slugIsValid = validWorldSlug(slug);
    const nameIsValid = normalizedName.length >= 1 && normalizedName.length <= 128;
    if (!slugIsValid || !nameIsValid) {
      setFormError("Use a valid slug and a name from 1 to 128 characters.");
      if (!slugIsValid) slugInputRef.current?.focus();
      else nameInputRef.current?.focus();
      return;
    }
    setFormError(null);
    mutation.mutate({ slug, name: normalizedName });
  };

  return (
    <section className="max-w-xl rounded-xl border bg-card p-5">
      <h2 className="font-medium">Create a world</h2>
      {!signedIn ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <Field data-invalid={Boolean(formError)}>
            <FieldLabel htmlFor="developer-user-id">Public user ID</FieldLabel>
            <Input
              aria-describedby={formError ? "developer-user-id-error" : undefined}
              aria-invalid={Boolean(formError)}
              id="developer-user-id"
              required
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <FieldError id="developer-user-id-error">{formError}</FieldError>
          </Field>
          <Button className="self-end" disabled={!userId.trim()} type="submit">
            Sign in
          </Button>
        </form>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>Signed in as {session.data?.user?.username}</span>
            <Button onClick={() => void signOut()} size="sm" type="button" variant="ghost">
              Sign out
            </Button>
          </div>
          <form className="mt-4 grid gap-4" onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={submitAttempted && !validWorldSlug(slug)}>
                <FieldLabel htmlFor="world-slug">Slug</FieldLabel>
                <Input
                  aria-describedby={
                    submitAttempted && !validWorldSlug(slug)
                      ? "world-slug-help world-slug-error"
                      : "world-slug-help"
                  }
                  aria-invalid={submitAttempted && !validWorldSlug(slug)}
                  id="world-slug"
                  maxLength={64}
                  ref={slugInputRef}
                  required
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
                <FieldDescription id="world-slug-help">
                  Lowercase letters, numbers, and single hyphens. Maximum 64 characters.
                </FieldDescription>
                <FieldError id="world-slug-error">
                  {submitAttempted && !validWorldSlug(slug) ? "Enter a valid slug." : null}
                </FieldError>
              </Field>
              <Field
                data-invalid={
                  submitAttempted && (name.trim().length < 1 || name.trim().length > 128)
                }
              >
                <FieldLabel htmlFor="world-name">Name</FieldLabel>
                <Input
                  aria-describedby={
                    submitAttempted && (name.trim().length < 1 || name.trim().length > 128)
                      ? "world-name-error"
                      : undefined
                  }
                  aria-invalid={
                    submitAttempted && (name.trim().length < 1 || name.trim().length > 128)
                  }
                  id="world-name"
                  maxLength={128}
                  ref={nameInputRef}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <FieldError id="world-name-error">
                  {submitAttempted && (name.trim().length < 1 || name.trim().length > 128)
                    ? "Enter a name from 1 to 128 characters."
                    : null}
                </FieldError>
              </Field>
            </FieldGroup>
            {formError &&
            validWorldSlug(slug) &&
            name.trim().length >= 1 &&
            name.trim().length <= 128 ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button disabled={mutation.isPending} type="submit">
              {mutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              {mutation.isPending ? "Creating..." : "Create world"}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}

function WorldRoute() {
  const { worldSlug } = useParams({ from: "/worlds/$worldSlug" });
  const world = useQuery({
    queryKey: ["worlds", worldSlug],
    queryFn: () => getWorld(worldSlug),
  });
  const navigate = useNavigate();

  if (world.isLoading)
    return (
      <main>
        <Loading label="Loading world" />
      </main>
    );
  if (world.isError) {
    return (
      <main className="p-8">
        <Alert variant="destructive">
          <AlertDescription>World not found or unavailable.</AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => void navigate({ to: "/" })} type="button">
          <ArrowLeftIcon data-icon="inline-start" />
          Back to worlds
        </Button>
      </main>
    );
  }

  return (
    <EditorWorkspace
      onNavigateHome={() => void navigate({ to: "/" })}
      onNavigateWorld={(slug) =>
        void navigate({ to: "/worlds/$worldSlug", params: { worldSlug: slug } })
      }
      world={world.data!}
      worldSlug={worldSlug}
    />
  );
}

function Loading({ label }: { readonly label: string }) {
  return (
    <div
      className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground"
      role="status"
    >
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

function NotFound() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <Link
        className="mt-3 inline-block underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        to="/"
      >
        Back to worlds
      </Link>
    </main>
  );
}
