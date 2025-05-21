import logging, time, functools

MAX_RETRIES  = 3
RETRY_DELAY  = 1.5

class RateLimitError(Exception):
    pass

def with_retry(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        retries = 0
        last_exception = None

        while retries < MAX_RETRIES:
            try:
                return func(*args, **kwargs)
            except RateLimitError as e:
                retry_after = getattr(e, "retry_after", RETRY_DELAY * (2**retries))
                logging.warning(f"Rate limited, retrying after {retry_after}s")
                time.sleep(retry_after)
                retries += 1
                last_exception = e
            except Exception as e:
                # Only retry for specific error types if needed
                retries += 1
                if retries >= MAX_RETRIES:
                    logging.error(f"Failed after {MAX_RETRIES} retries: {e}")
                    raise
                delay = (
                    RETRY_DELAY * (2 ** (retries - 1)) * (0.9 + 0.2 * (time.time() % 1))
                )
                logging.warning(f"Retry {retries}/{MAX_RETRIES} after {delay:.2f}s: {e}")
                time.sleep(delay)
                last_exception = e
        if last_exception:
            raise last_exception
        raise Exception("Max retries reached without attempting")
    return wrapper
