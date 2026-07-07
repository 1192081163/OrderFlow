import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "server" / "mihomo_imap_node_keeper.py"


def load_keeper_module():
    spec = importlib.util.spec_from_file_location("mihomo_imap_node_keeper", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeController:
    def __init__(self, current, candidates, proxy_types=None):
        self.current = current
        self._candidates = candidates
        self.proxy_types = proxy_types or {}
        self.selected = []

    def current_proxy(self, group):
        return self.current

    def candidates(self, group):
        return list(self._candidates)

    def proxy_type(self, name):
        return self.proxy_types.get(name, "Vmess")

    def select_proxy(self, group, name):
        self.selected.append((group, name))
        self.current = name


class FakeChecker:
    def __init__(self, healthy):
        self.healthy = healthy
        self.checked = []

    def __call__(self):
        name = self.current_proxy
        self.checked.append(name)
        return self.healthy.get(name, False)


class NodeKeeperTests(unittest.TestCase):
    def setUp(self):
        self.module = load_keeper_module()

    def test_leaves_current_node_when_imap_is_healthy(self):
        controller = FakeController("good", ["bad", "good"])
        checker = FakeChecker({"good": True})
        checker.current_proxy = "good"

        result = self.module.NodeKeeper(controller, checker).run()

        self.assertEqual(result.status, "healthy")
        self.assertEqual(controller.selected, [])
        self.assertEqual(checker.checked, ["good"])

    def test_switches_to_first_candidate_that_passes_imap_check(self):
        controller = FakeController("old", ["old", "bad", "good", "later"])
        checker = FakeChecker({"old": False, "bad": False, "good": True, "later": True})

        def check():
            checker.current_proxy = controller.current
            return checker()

        result = self.module.NodeKeeper(controller, check).run()

        self.assertEqual(result.status, "switched")
        self.assertEqual(result.selected, "good")
        self.assertEqual(controller.current, "good")
        self.assertEqual(controller.selected, [("GLOBAL", "bad"), ("GLOBAL", "good")])
        self.assertEqual(checker.checked, ["old", "bad", "good"])

    def test_restores_original_node_when_no_candidate_passes(self):
        controller = FakeController("old", ["old", "bad1", "bad2"])
        checker = FakeChecker({"old": False, "bad1": False, "bad2": False})

        def check():
            checker.current_proxy = controller.current
            return checker()

        result = self.module.NodeKeeper(controller, check).run()

        self.assertEqual(result.status, "failed")
        self.assertEqual(controller.current, "old")
        self.assertEqual(
            controller.selected,
            [("GLOBAL", "bad1"), ("GLOBAL", "bad2"), ("GLOBAL", "old")],
        )
        self.assertEqual(checker.checked, ["old", "bad1", "bad2"])

    def test_skips_reject_and_selector_candidates(self):
        controller = FakeController(
            "old",
            ["REJECT", "nested-group", "good"],
            proxy_types={"REJECT": "Reject", "nested-group": "Selector", "good": "Vmess"},
        )
        checker = FakeChecker({"old": False, "good": True})

        def check():
            checker.current_proxy = controller.current
            return checker()

        result = self.module.NodeKeeper(controller, check).run()

        self.assertEqual(result.status, "switched")
        self.assertEqual(result.selected, "good")
        self.assertEqual(controller.selected, [("GLOBAL", "good")])
        self.assertEqual(checker.checked, ["old", "good"])

    def test_accepts_curl_imap_capability_output_as_healthy(self):
        output = """
        * SOCKS5 request granted.
        * OK [CAPABILITY IMAP4 IMAP4rev1 ID AUTH=PLAIN AUTH=LOGIN NAMESPACE] QQMail IMAP4Server ready
        A001 OK CAPABILITY Completed
        curl: (21) Quote command returned error
        """

        self.assertTrue(self.module.is_imap_curl_output_healthy(21, output))

    def test_rejects_curl_ssl_error_output_as_unhealthy(self):
        output = "curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection imap.exmail.qq.com:993"

        self.assertFalse(self.module.is_imap_curl_output_healthy(35, output))


if __name__ == "__main__":
    unittest.main()
