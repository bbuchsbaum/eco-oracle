use_ecooracle <- function(path = ".",
                          overwrite = FALSE,
                          registry_repo = Sys.getenv("ECO_REGISTRY_REPO", unset = "bbuchsbaum/eco-registry"),
                          registry_ref = Sys.getenv("ECO_REGISTRY_REF", unset = "main"),
                          set_openai_secret = TRUE,
                          openai_secret_scope = c("repo", "org"),
                          secret_name = "OPENAI_API_KEY",
                          target_repo = Sys.getenv("ECO_TARGET_REPO", unset = "")) {
  openai_secret_scope <- match.arg(openai_secret_scope)
  target_path <- normalizePath(path, winslash = "/", mustWork = TRUE)
  desc_path <- file.path(target_path, "DESCRIPTION")

  if (!file.exists(desc_path)) {
    stop("`path` must point to an R package root containing DESCRIPTION.", call. = FALSE)
  }

  script_path <- system.file("scripts", "bootstrap-package.sh", package = "ecooracle")
  if (!nzchar(script_path) || !file.exists(script_path)) {
    stop("Could not find the bundled EcoOracle bootstrap script.", call. = FALSE)
  }

  env <- c(
    paste0("ECO_REGISTRY_REPO=", registry_repo),
    paste0("ECO_REGISTRY_REF=", registry_ref),
    paste0("ECO_TEMPLATE_OVERWRITE=", if (overwrite) "1" else "0"),
    paste0("ECO_SET_OPENAI_SECRET=", if (set_openai_secret) "1" else "0"),
    paste0("ECO_OPENAI_SECRET_SCOPE=", openai_secret_scope),
    paste0("ECO_OPENAI_SECRET_NAME=", secret_name)
  )

  if (nzchar(target_repo)) {
    env <- c(env, paste0("ECO_TARGET_REPO=", target_repo))
  }

  for (name in c("OPENAI_API_KEY", "GITHUB_TOKEN")) {
    value <- Sys.getenv(name, unset = "")
    if (nzchar(value)) {
      env <- c(env, paste0(name, "=", value))
    }
  }

  old_wd <- setwd(target_path)
  on.exit(setwd(old_wd), add = TRUE)

  output <- tryCatch(
    system2("bash", script_path, stdout = TRUE, stderr = TRUE, env = env),
    error = function(e) {
      stop(sprintf("Failed to run EcoOracle bootstrap script: %s", conditionMessage(e)), call. = FALSE)
    }
  )

  status <- attr(output, "status", exact = TRUE)
  if (!is.null(status) && !identical(status, 0L)) {
    stop(
      paste(c("EcoOracle bootstrap failed:", output), collapse = "\n"),
      call. = FALSE
    )
  }

  if (length(output) > 0) {
    cat(paste(output, collapse = "\n"), sep = "\n")
    if (!grepl("\n$", output[[length(output)]], perl = TRUE)) {
      cat("\n")
    }
  }

  invisible(list(
    path = target_path,
    overwrite = overwrite,
    files = normalizePath(
      file.path(
        target_path,
        c(
          ".ecosystem.yml",
          ".github/workflows/eco-atlas.yml",
          "tools/eco_atlas_extract.R",
          "tools/eco_atlas_distill.mjs"
        )
      ),
      winslash = "/",
      mustWork = FALSE
    )
  ))
}

