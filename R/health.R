check_health <- function(scope = c("repo", "release", "registry"),
                         path = ".",
                         repo = Sys.getenv("ECO_TARGET_REPO", unset = ""),
                         registry_url = Sys.getenv(
                           "ECO_REGISTRY_URL",
                           unset = "https://raw.githubusercontent.com/bbuchsbaum/eco-registry/main/registry.json"
                         ),
                         tag = Sys.getenv("ECO_RELEASE_TAG", unset = "eco-atlas"),
                         asset = Sys.getenv("ECO_RELEASE_ASSET", unset = "atlas-pack.tgz")) {
  scope <- match.arg(scope)
  target_path <- normalizePath(path, winslash = "/", mustWork = TRUE)
  script_path <- system.file("scripts", "eco-doctor.sh", package = "ecooracle")

  if (!nzchar(script_path) || !file.exists(script_path)) {
    stop("Could not find the bundled EcoDoctor script.", call. = FALSE)
  }

  old_wd <- setwd(target_path)
  on.exit(setwd(old_wd), add = TRUE)

  args <- c(script_path, scope, "--json")
  if (nzchar(repo)) {
    args <- c(args, "--repo", repo)
  }
  if (identical(scope, "release")) {
    if (nzchar(tag)) {
      args <- c(args, "--tag", tag)
    }
    if (nzchar(asset)) {
      args <- c(args, "--asset", asset)
    }
  }
  if (identical(scope, "registry") && nzchar(registry_url)) {
    args <- c(args, "--registry-url", registry_url)
  }

  result <- run_ecooracle_command("bash", args, path = target_path, check = FALSE)
  body <- paste(result$output, collapse = "\n")
  if (!nzchar(body)) {
    stop("EcoDoctor did not return any output.", call. = FALSE)
  }

  if (!identical(result$status, 0L) && !identical(result$status, 1L)) {
    stop(
      paste(c("EcoDoctor failed:", result$output), collapse = "\n"),
      call. = FALSE
    )
  }

  parsed <- fromJSON(body, simplifyVector = TRUE)
  parsed$exit_status <- result$status
  parsed$path <- target_path
  class(parsed) <- c("ecooracle_health", class(parsed))
  parsed
}

health <- function(...) {
  check_health(...)
}

print.ecooracle_health <- function(x, ...) {
  cat(sprintf("EcoOracle health: %s (%s)\n", toupper(x$status), x$command))
  if (!is.null(x$counts)) {
    cat(
      sprintf(
        "PASS=%s WARN=%s FAIL=%s\n",
        x$counts$pass %||% 0L,
        x$counts$warn %||% 0L,
        x$counts$fail %||% 0L
      )
    )
  }

  checks <- x$checks
  if (is.data.frame(checks) && nrow(checks) > 0) {
    for (idx in seq_len(nrow(checks))) {
      cat(sprintf("[%s] %s - %s\n", toupper(checks$status[[idx]]), checks$id[[idx]], checks$detail[[idx]]))
    }
  }

  invisible(x)
}
