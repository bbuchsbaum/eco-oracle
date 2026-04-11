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
  target_repo = Sys.getenv("ECO_TARGET_REPO", unset = "")
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
}
\value{
  Invisibly returns a list containing the target path, overwrite flag, and the
  expected scaffolded file paths.
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
  templates without hand-editing YAML.
}
\examples{
\dontrun{
library(ecooracle)

## scaffold a new package repo from its root
use_ecooracle()

## refresh an existing package to the latest templates
use_ecooracle(overwrite = TRUE)
}
}

