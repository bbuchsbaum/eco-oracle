run_ecooracle_command <- function(command,
                                  args = character(),
                                  path = ".",
                                  env = character(),
                                  check = TRUE) {
  output <- tryCatch(
    suppressWarnings(system2(command, args, stdout = TRUE, stderr = TRUE, env = env)),
    error = function(e) {
      stop(sprintf("Failed to run `%s`: %s", command, conditionMessage(e)), call. = FALSE)
    }
  )

  status <- attr(output, "status", exact = TRUE)
  if (is.null(status)) {
    status <- 0L
  }

  if (check && !identical(status, 0L)) {
    stop(
      paste(
        c(
          sprintf("Command failed: %s %s", command, paste(args, collapse = " ")),
          output
        ),
        collapse = "\n"
      ),
      call. = FALSE
    )
  }

  list(
    status = status,
    output = output,
    path = normalizePath(path, winslash = "/", mustWork = TRUE)
  )
}

`%||%` <- function(x, y) {
  if (is.null(x) || length(x) == 0 || all(is.na(x))) {
    return(y)
  }
  x
}

cat_command_output <- function(output) {
  if (length(output) == 0) {
    return(invisible(NULL))
  }
  cat(paste(output, collapse = "\n"), sep = "\n")
  if (!grepl("\n$", output[[length(output)]], perl = TRUE)) {
    cat("\n")
  }
  invisible(NULL)
}

read_description_fields <- function(desc_path) {
  if (!file.exists(desc_path)) {
    stop("DESCRIPTION not found.", call. = FALSE)
  }
  as.list(read.dcf(desc_path)[1, , drop = TRUE])
}

parse_namespace_exports <- function(ns_path, pkg_name) {
  if (!file.exists(ns_path)) {
    return(character())
  }

  raw <- readLines(ns_path, warn = FALSE)
  exports <- character()
  for (line in raw) {
    m <- regmatches(line, regexec("export\\s*\\(([^)]*)\\)", line, perl = TRUE))[[1]]
    if (length(m) < 2) {
      next
    }
    parts <- strsplit(m[[2]], ",", fixed = TRUE)[[1]]
    parts <- trimws(gsub("^[\"']|[\"']$", "", parts))
    parts <- parts[nzchar(parts)]
    if (length(parts) > 0) {
      exports <- c(exports, paste0(pkg_name, "::", parts))
    }
  }

  unique(exports)
}

split_package_tokens <- function(text) {
  if (length(text) == 0 || all(is.na(text))) {
    return(character())
  }
  tokens <- unlist(strsplit(tolower(text), "[^a-z0-9]+", perl = TRUE), use.names = FALSE)
  tokens[nzchar(tokens)]
}

infer_role_from_description <- function(title, description) {
  text <- paste(title %||% "", description %||% "")
  checks <- list(
    ingest = "\\b(read|load|import|download|fetch|parse|ingest|input|file|dataset)\\b",
    clean = "\\b(clean|sanitize|validate|dedup|repair|qc|quality)\\b",
    transform = "\\b(transform|convert|reshape|wrangle|process|canonicali[sz]e|normalize)\\b",
    model = "\\b(model|fit|predict|classif|regress|bayes|cluster|estimate|inference)\\b",
    viz = "\\b(plot|visuali[sz]e|chart|graph|figure)\\b",
    report = "\\b(report|summary|dashboard|table)\\b",
    io = "\\b(export|write|serialize|save|io|input/output)\\b"
  )

  for (name in names(checks)) {
    if (grepl(checks[[name]], text, ignore.case = TRUE, perl = TRUE)) {
      return(name)
    }
  }

  "transform"
}

infer_tags_from_description <- function(pkg_name, title, description, role) {
  stopwords <- c(
    "a", "an", "and", "analysis", "for", "from", "in", "of", "on", "package",
    "packages", "r", "the", "to", "tool", "tools", "with"
  )

  tokens <- unique(c(
    split_package_tokens(gsub("([a-z0-9])([A-Z])", "\\1 \\2", pkg_name, perl = TRUE)),
    split_package_tokens(title %||% ""),
    split_package_tokens(description %||% "")
  ))

  tokens <- tokens[!tokens %in% unique(c(stopwords, split_package_tokens(pkg_name), role))]
  tokens <- tokens[nchar(tokens) >= 3]

  if (length(tokens) == 0) {
    return(pkg_name)
  }

  head(tokens, 5)
}

read_ecosystem_lines <- function(eco_path) {
  if (!file.exists(eco_path)) {
    return(character())
  }
  readLines(eco_path, warn = FALSE)
}

read_ecosystem_scalar <- function(lines, key) {
  pattern <- sprintf("^%s:\\s*(.*)$", key)
  for (line in lines) {
    m <- regmatches(line, regexec(pattern, trimws(line), perl = TRUE))[[1]]
    if (length(m) < 2) {
      next
    }
    value <- trimws(m[[2]])
    return(gsub("^[\"']|[\"']$", "", value))
  }
  NULL
}

read_ecosystem_list <- function(lines, key) {
  key_inline_pattern <- sprintf("^%s:\\s*\\[(.*)\\]\\s*$", key)
  key_block_pattern <- sprintf("^%s:\\s*$", key)

  for (line in lines) {
    trimmed <- trimws(line)
    m <- regmatches(trimmed, regexec(key_inline_pattern, trimmed, perl = TRUE))[[1]]
    if (length(m) >= 2) {
      values <- trimws(strsplit(m[[2]], ",", fixed = TRUE)[[1]])
      values <- gsub("^[\"']|[\"']$", "", values)
      values <- values[nzchar(values)]
      return(values)
    }
  }

  start <- which(vapply(lines, function(line) grepl(key_block_pattern, trimws(line), perl = TRUE), logical(1)))
  if (length(start) == 0) {
    return(character())
  }

  idx <- start[[1]] + 1L
  values <- character()
  while (idx <= length(lines)) {
    line <- lines[[idx]]
    if (grepl("^\\s*-\\s+", line, perl = TRUE)) {
      value <- gsub("^\\s*-\\s+", "", line, perl = TRUE)
      value <- trimws(gsub("\\s+#.*$", "", value, perl = TRUE))
      value <- gsub("^[\"']|[\"']$", "", value)
      if (nzchar(value)) {
        values <- c(values, value)
      }
      idx <- idx + 1L
      next
    }
    if (grepl("^\\s*$", line, perl = TRUE)) {
      idx <- idx + 1L
      next
    }
    break
  }

  values
}

replace_ecosystem_scalar <- function(lines, key, value) {
  new_line <- sprintf("%s: %s", key, value)
  pattern <- sprintf("^%s:\\s*.*$", key)
  idx <- which(vapply(lines, function(line) grepl(pattern, trimws(line), perl = TRUE), logical(1)))

  if (length(idx) == 0) {
    return(c(lines, new_line))
  }

  lines[[idx[[1]]]] <- new_line
  lines
}

replace_ecosystem_list <- function(lines, key, values) {
  block <- c(sprintf("%s:", key), if (length(values) > 0) paste0("  - ", values) else character())
  key_inline_pattern <- sprintf("^%s:\\s*\\[.*\\]\\s*$", key)
  key_block_pattern <- sprintf("^%s:\\s*$", key)
  idx <- which(vapply(lines, function(line) {
    trimmed <- trimws(line)
    grepl(key_inline_pattern, trimmed, perl = TRUE) || grepl(key_block_pattern, trimmed, perl = TRUE)
  }, logical(1)))

  if (length(idx) == 0) {
    return(c(lines, block))
  }

  start <- idx[[1]]
  end <- start
  if (grepl(key_block_pattern, trimws(lines[[start]]), perl = TRUE)) {
    end <- start
    while (end + 1L <= length(lines)) {
      next_line <- lines[[end + 1L]]
      if (grepl("^\\s*-\\s+", next_line, perl = TRUE) || grepl("^\\s*$", next_line, perl = TRUE)) {
        end <- end + 1L
        next
      }
      break
    }
  }

  c(lines[seq_len(start - 1L)], block, if (end < length(lines)) lines[(end + 1L):length(lines)] else character())
}

same_character_values <- function(x, y) {
  identical(as.character(x), as.character(y))
}

is_placeholder_tags <- function(tags) {
  length(tags) == 0 || same_character_values(tags, c("domain-tag", "workflow-tag"))
}

is_placeholder_entrypoints <- function(entrypoints) {
  length(entrypoints) == 0
}

normalize_follow_through_flag <- function(value, prompt, question) {
  if (!is.logical(value) || length(value) != 1L) {
    stop("Follow-through flags must be TRUE, FALSE, or NA.", call. = FALSE)
  }

  if (!is.na(value)) {
    return(isTRUE(value))
  }

  if (!isTRUE(prompt)) {
    return(FALSE)
  }

  answer <- readline(sprintf("%s [y/N]: ", question))
  identical(tolower(trimws(answer)), "y")
}

infer_repo_slug <- function(path, target_repo = "") {
  if (nzchar(target_repo)) {
    return(target_repo)
  }

  gh <- run_ecooracle_command(
    "gh",
    c("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"),
    path = path,
    check = FALSE
  )
  if (identical(gh$status, 0L)) {
    slug <- trimws(paste(gh$output, collapse = "\n"))
    if (nzchar(slug)) {
      return(slug)
    }
  }

  remote <- run_ecooracle_command(
    "git",
    c("config", "--get", "remote.origin.url"),
    path = path,
    check = FALSE
  )
  if (!identical(remote$status, 0L)) {
    return("")
  }

  url <- trimws(paste(remote$output, collapse = "\n"))
  url <- sub("\\.git$", "", url)
  patterns <- c("^git@github.com:(.+/.+)$", "^https://github.com/(.+/.+)$", "^http://github.com/(.+/.+)$")
  for (pattern in patterns) {
    match <- regmatches(url, regexec(pattern, url, perl = TRUE))[[1]]
    if (length(match) >= 2) {
      return(match[[2]])
    }
  }

  ""
}

update_ecosystem_metadata <- function(path,
                                      role = NULL,
                                      tags = NULL,
                                      entrypoints = NULL,
                                      infer_metadata = TRUE) {
  eco_path <- file.path(path, ".ecosystem.yml")
  lines <- read_ecosystem_lines(eco_path)
  if (length(lines) == 0) {
    return(list(updated = FALSE, role = NULL, tags = character(), entrypoints = character()))
  }

  desc <- read_description_fields(file.path(path, "DESCRIPTION"))
  pkg_name <- desc[["Package"]]
  title <- desc[["Title"]]
  description <- desc[["Description"]]
  existing_role <- read_ecosystem_scalar(lines, "role")
  existing_tags <- read_ecosystem_list(lines, "tags")
  existing_entrypoints <- read_ecosystem_list(lines, "entrypoints")
  inferred_entrypoints <- parse_namespace_exports(file.path(path, "NAMESPACE"), pkg_name)

  role_is_placeholder <- is.null(existing_role) || !nzchar(existing_role) ||
    (identical(existing_role, "transform") && (is_placeholder_tags(existing_tags) || is_placeholder_entrypoints(existing_entrypoints)))

  resolved_role <- existing_role
  if (!is.null(role)) {
    resolved_role <- role
  } else if (infer_metadata && role_is_placeholder) {
    resolved_role <- infer_role_from_description(title, description)
  }

  resolved_tags <- existing_tags
  if (!is.null(tags)) {
    resolved_tags <- unique(as.character(tags))
  } else if (infer_metadata && is_placeholder_tags(existing_tags)) {
    resolved_tags <- infer_tags_from_description(pkg_name, title, description, resolved_role)
  }

  resolved_entrypoints <- existing_entrypoints
  if (!is.null(entrypoints)) {
    resolved_entrypoints <- unique(as.character(entrypoints))
  } else if (infer_metadata && is_placeholder_entrypoints(existing_entrypoints) && length(inferred_entrypoints) > 0) {
    resolved_entrypoints <- head(inferred_entrypoints, 5)
  }

  updated <- FALSE
  if (!is.null(resolved_role) && !same_character_values(existing_role, resolved_role)) {
    lines <- replace_ecosystem_scalar(lines, "role", resolved_role)
    updated <- TRUE
  }
  if (!same_character_values(existing_tags, resolved_tags)) {
    lines <- replace_ecosystem_list(lines, "tags", resolved_tags)
    updated <- TRUE
  }
  if (!same_character_values(existing_entrypoints, resolved_entrypoints)) {
    lines <- replace_ecosystem_list(lines, "entrypoints", resolved_entrypoints)
    updated <- TRUE
  }

  if (updated) {
    writeLines(lines, eco_path, useBytes = TRUE)
  }

  list(
    updated = updated,
    role = resolved_role,
    tags = resolved_tags,
    entrypoints = resolved_entrypoints
  )
}

onboarding_file_paths <- function(path) {
  c(
    ".ecosystem.yml",
    ".github/workflows/eco-atlas.yml",
    "tools/eco_atlas_extract.R",
    "tools/eco_atlas_distill.mjs"
  )
}

has_onboarding_changes <- function(path, files) {
  repo <- run_ecooracle_command(
    "git",
    c("status", "--short", "--", files),
    path = path,
    check = FALSE
  )
  identical(repo$status, 0L) && length(repo$output) > 0
}

commit_onboarding_files <- function(path, files, message) {
  run_ecooracle_command("git", c("add", "--", files), path = path)
  staged <- run_ecooracle_command("git", c("diff", "--cached", "--name-only", "--", files), path = path, check = FALSE)
  if (length(staged$output) == 0) {
    return(list(committed = FALSE, output = "No onboarding changes to commit."))
  }

  result <- run_ecooracle_command("git", c("commit", "-m", shQuote(message), "--", files), path = path)
  list(committed = TRUE, output = result$output)
}

push_current_branch <- function(path) {
  run_ecooracle_command("git", c("push"), path = path)
}

trigger_package_workflow <- function(path, repo_slug = "") {
  args <- c("workflow", "run", "eco-atlas.yml")
  if (nzchar(repo_slug)) {
    args <- c(args, "--repo", repo_slug)
  }
  run_ecooracle_command("gh", args, path = path)
}

trigger_registry_discovery <- function(path, repo_slug) {
  run_ecooracle_command(
    "gh",
    c("workflow", "run", "discover-registry.yml", "--repo", repo_slug),
    path = path
  )
}

use_ecooracle <- function(path = ".",
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
                          commit_message = "Add EcoOracle onboarding") {
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

  bootstrap <- run_ecooracle_command("bash", script_path, path = target_path, env = env)
  bootstrap_output <- bootstrap$output[
    bootstrap$output != "[bootstrap] IMPORTANT: update .ecosystem.yml role/tags/entrypoints before commit."
  ]
  cat_command_output(bootstrap_output)

  metadata <- update_ecosystem_metadata(
    path = target_path,
    role = role,
    tags = tags,
    entrypoints = entrypoints,
    infer_metadata = infer_metadata
  )
  if (metadata$updated) {
    cat("[ecooracle] Updated .ecosystem.yml with inferred metadata.\n")
  }
  if (!is.null(metadata$role) || length(metadata$tags) > 0 || length(metadata$entrypoints) > 0) {
    cat(sprintf("[ecooracle] role: %s\n", if (is.null(metadata$role)) "" else metadata$role))
    cat(sprintf("[ecooracle] tags: %s\n", paste(metadata$tags, collapse = ", ")))
    cat(sprintf("[ecooracle] entrypoints: %s\n", paste(metadata$entrypoints, collapse = ", ")))
  }

  files <- onboarding_file_paths(target_path)
  repo_slug <- infer_repo_slug(target_path, target_repo = target_repo)

  commit_now <- normalize_follow_through_flag(
    commit,
    prompt,
    "Commit EcoOracle onboarding files now?"
  )

  commit_result <- list(committed = FALSE, output = character())
  if (commit_now) {
    commit_result <- commit_onboarding_files(target_path, files, commit_message)
    cat_command_output(commit_result$output)
  }

  if (!commit_now && has_onboarding_changes(target_path, files) && isTRUE(push)) {
    stop("Cannot push onboarding changes before committing them. Set `commit = TRUE` or commit manually.", call. = FALSE)
  }

  push_now <- normalize_follow_through_flag(
    push,
    prompt,
    "Push the current branch now?"
  )
  if (push_now && has_onboarding_changes(target_path, files)) {
    stop("Cannot push while onboarding files still have uncommitted changes. Commit them first or set `push = FALSE`.", call. = FALSE)
  }
  if (push_now) {
    push_result <- push_current_branch(target_path)
    cat_command_output(push_result$output)
  } else {
    push_result <- list(status = 0L, output = character())
  }

  workflow_now <- normalize_follow_through_flag(
    run_workflow,
    prompt,
    "Trigger the eco-atlas workflow now?"
  )
  if (workflow_now) {
    workflow_result <- trigger_package_workflow(target_path, repo_slug = repo_slug)
    cat_command_output(workflow_result$output)
  } else {
    workflow_result <- list(status = 0L, output = character())
  }

  discovery_now <- normalize_follow_through_flag(
    run_discovery,
    prompt,
    sprintf("Trigger registry discovery in %s now?", registry_repo)
  )
  if (discovery_now) {
    discovery_result <- trigger_registry_discovery(target_path, registry_repo)
    cat_command_output(discovery_result$output)
  } else {
    discovery_result <- list(status = 0L, output = character())
  }

  invisible(list(
    path = target_path,
    overwrite = overwrite,
    files = normalizePath(file.path(target_path, files), winslash = "/", mustWork = FALSE),
    metadata = metadata,
    commit = commit_result,
    push = push_result,
    workflow = workflow_result,
    discovery = discovery_result
  ))
}
