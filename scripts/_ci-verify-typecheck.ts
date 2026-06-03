// Throwaway file — exists ONLY to verify that branch protection blocks merge
// when CI fails. Lives in the chore/verify-branch-protection branch and is
// deleted when the disposable verification PR is closed.
//
// Do NOT merge this file into main.

const _typecheckTrap: number = "intentional type error to verify CI blocks merge";
export { _typecheckTrap };
