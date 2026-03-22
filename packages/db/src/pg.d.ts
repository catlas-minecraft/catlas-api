declare module "pg" {
  export const types: {
    setTypeParser: (oid: number, parser: (value: string) => unknown) => void
  }
}
