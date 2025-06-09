#!/usr/bin/env bash
    #
    # rewrite_author.sh
    # Rewrites ALL commits so that any commit whose author/committer
    # is not “Henry Perkins <htperkins@gmail.com>” is rewritten to that identity.
    #
    # 1. Creates an automatic backup branch first.
    # 2. Uses git filter-branch’s --env-filter to adjust metadata.
    # 3. Leaves tags intact.
    #
    # After it finishes, force-push the branch(es) you want to update:
    #   git push --force-with-lease origin <branch>

    set -euo pipefail

    CORRECT_NAME="Henry Perkins"
    CORRECT_EMAIL="htperkins@gmail.com"
    BACKUP_BRANCH="backup/pre-author-rewrite-$(date +%Y%m%d-%H%M%S)"

    echo "Creating backup branch: $BACKUP_BRANCH"
    git branch "$BACKUP_BRANCH"

    echo "Rewriting history… (this can take a while on large repos)"
    git filter-branch \
      --env-filter '
        CORRECT_NAME="'"${CORRECT_NAME}"'"
        CORRECT_EMAIL="'"${CORRECT_EMAIL}"'"

        if [ "$GIT_COMMITTER_NAME" != "$CORRECT_NAME" ] || \
           [ "$GIT_COMMITTER_EMAIL" != "$CORRECT_EMAIL" ]; then
            export GIT_COMMITTER_NAME="$CORRECT_NAME"
            export GIT_COMMITTER_EMAIL="$CORRECT_EMAIL"
        fi
        if [ "$GIT_AUTHOR_NAME" != "$CORRECT_NAME" ] || \
           [ "$GIT_AUTHOR_EMAIL" != "$CORRECT_EMAIL" ]; then
            export GIT_AUTHOR_NAME="$CORRECT_NAME"
            export GIT_AUTHOR_EMAIL="$CORRECT_EMAIL"
        fi
      ' \
      --tag-name-filter cat -- --all

    echo ""
    echo "✔ History rewrite complete."
    echo "--------------------------------------------------------------------"
    echo "Next steps:"
    echo "  1. Verify the result:         git log --format=\"%h %an <%ae> %s\""
    echo "  2. Force-push updated refs:   git push --force-with-lease --all"
    echo "  3. Force-push tags (optional) git push --force-with-lease --tags"
    echo ""
    echo "Every collaborator must now re-clone or hard-reset their local clones."
