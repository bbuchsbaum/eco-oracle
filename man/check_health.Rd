\name{check_health}
\alias{check_health}
\alias{health}
\title{Run EcoDoctor Health Checks}
\usage{
check_health(
  scope = c("repo", "release", "registry"),
  path = ".",
  repo = Sys.getenv("ECO_TARGET_REPO", unset = ""),
  registry_url = Sys.getenv(
    "ECO_REGISTRY_URL",
    unset = "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"
  ),
  tag = Sys.getenv("ECO_RELEASE_TAG", unset = "eco-atlas"),
  asset = Sys.getenv("ECO_RELEASE_ASSET", unset = "atlas-pack.tgz")
)

health(...)
}
\arguments{
  \item{scope}{Which EcoDoctor mode to run: repository-local checks,
  release-asset checks, or registry checks.}

  \item{path}{Path to the target repository.}

  \item{repo}{Optional \code{owner/repo} override used for release and registry
  checks.}

  \item{registry_url}{Registry URL or local file path used for
  \code{scope = "registry"}.}

  \item{tag}{Release tag used for \code{scope = "release"}.}

  \item{asset}{Release asset used for \code{scope = "release"}.}

  \item{...}{Arguments forwarded to \code{check_health()}.}
}
\value{
  An object of class \code{ecooracle_health} containing the parsed EcoDoctor
  JSON result, including overall status, check counts, individual checks, exit
  status, and target path.
}
\description{
  Runs the bundled EcoDoctor health checks from R. This is a thin wrapper around
  the canonical \code{eco-doctor.sh} script, so the R package and CLI report the
  same repository, release, and registry diagnostics.
}
\details{
  \code{check_health()} returns the parsed result even when checks fail, as long
  as EcoDoctor itself ran successfully. A failing health check therefore returns
  an object with \code{status = "fail"} rather than raising an error.

  \code{health()} is a shorthand alias for \code{check_health()}.
}
\examples{
\dontrun{
library(ecooracle)

## local repo readiness
check_health()

## release asset checks
check_health(scope = "release", repo = "bbuchsbaum/fmrihrf")

## registry presence checks
health(scope = "registry", repo = "bbuchsbaum/fmrihrf")
}
}
