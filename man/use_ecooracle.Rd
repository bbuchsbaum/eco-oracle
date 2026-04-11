\name{use_ecooracle}
\alias{use_ecooracle}
\title{Bootstrap EcoOracle Support in an R Package Repository}
\usage{
use_ecooracle(
  path = ".",
  overwrite = FALSE,
  registry_repo = Sys.getenv("ECO_REGISTRY_REPO", unset = "bbuchsbaum/eco-registry"),
  registry_ref = Sys.getenv("ECO_REGISTRY_REF", unset = "main"),
  set_openai_secret = TRUE,
  openai_secret_scope = c("repo", "org"),
  secret_name = "OPENAI_API_KEY",
  target_repo = Sys.getenv("ECO_TARGET_REPO", unset = ""),
  role = NULL,
  tags = NULL,
  entrypoints = NULL,
  infer_metadata = TRUE,
  commit = NA,
  push = NA,
  run_workflow = NA,
  run_discovery = NA,
  prompt = interactive(),
  commit_message = "Add EcoOracle onboarding"
)
}
\arguments{
  \item{path}{Path to the target R package repository.}

  \item{overwrite}{Overwrite existing workflow and tool templates. Use \code{TRUE}
  to refresh an already-bootstrapped repository.}

  \item{registry_repo}{GitHub repository that hosts the canonical
  \code{eco-registry} templates.}

  \item{registry_ref}{Branch or tag to read from \code{registry_repo}.}

  \item{set_openai_secret}{Attempt to configure the \code{OPENAI_API_KEY}
  GitHub secret when \code{gh} is available and the environment variable is
  present.}

  \item{openai_secret_scope}{Secret scope passed through to the bootstrap
  script.}

  \item{secret_name}{Name of the GitHub secret to configure.}

  \item{target_repo}{Optional \code{owner/repo} override used when setting the
  GitHub secret.}

  \item{role}{Optional explicit role to write into \code{.ecosystem.yml}.}

  \item{tags}{Optional explicit tag vector to write into
  \code{.ecosystem.yml}.}

  \item{entrypoints}{Optional explicit entrypoint vector to write into
  \code{.ecosystem.yml}.}

  \item{infer_metadata}{When \code{TRUE}, fill placeholder
  \code{role}/\code{tags}/\code{entrypoints} from DESCRIPTION and NAMESPACE.}

  \item{commit}{Whether to commit the onboarding files. Use \code{NA} to ask in
  interactive sessions and skip in non-interactive sessions.}

  \item{push}{Whether to push the current branch after committing. Use
  \code{NA} to ask in interactive sessions and skip in non-interactive
  sessions.}

  \item{run_workflow}{Whether to trigger the \code{eco-atlas.yml} workflow now.
  Use \code{NA} to ask in interactive sessions and skip in non-interactive
  sessions.}

  \item{run_discovery}{Whether to trigger registry discovery in
  \code{registry_repo}. Use \code{NA} to ask in interactive sessions and skip
  in non-interactive sessions.}

  \item{prompt}{Enable yes/no prompts for follow-through steps whose arguments
  are \code{NA}.}

  \item{commit_message}{Commit message used when \code{commit = TRUE}.}
}
\value{
  Invisibly returns a list containing the target path, scaffolded file paths,
  inferred metadata, and the results of any follow-through steps that ran.
}
\description{
  Wraps the canonical EcoOracle bootstrap shell script so package authors can
  opt into EcoOracle directly from R with
  \code{library(ecooracle); ecooracle::use_ecooracle()}.
}
\details{
  New repositories can call \code{use_ecooracle()} once to scaffold the initial
  files. Existing repositories can call
  \code{use_ecooracle(overwrite = TRUE)} to refresh the workflow and tool
  templates without hand-editing YAML. By default the function also fills in
  basic \code{role}, \code{tags}, and \code{entrypoints} when
  \code{.ecosystem.yml} still contains bootstrap placeholders.

  In interactive sessions, \code{commit}, \code{push}, \code{run_workflow}, and
  \code{run_discovery} default to \code{NA}, which causes
  \code{use_ecooracle()} to ask whether you want to run those steps. In
  non-interactive sessions, \code{NA} means skip.
}
\examples{
\dontrun{
library(ecooracle)

## scaffold a new package repo from its root
use_ecooracle()

## refresh an existing package to the latest templates
use_ecooracle(overwrite = TRUE)

## run the rest of the onboarding flow without prompts
use_ecooracle(
  commit = TRUE,
  push = TRUE,
  run_workflow = TRUE,
  run_discovery = TRUE
)
}
}
