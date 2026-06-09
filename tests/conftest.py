import importlib.util
import os
import sys


def _import_hook(name, filename):
    hook_path = os.path.join(os.path.dirname(__file__), "..", "hooks", filename)
    hook_path = os.path.abspath(hook_path)
    spec = importlib.util.spec_from_file_location(name, hook_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sys.modules["smart_compose"] = _import_hook("smart_compose", "smart-compose.py")
