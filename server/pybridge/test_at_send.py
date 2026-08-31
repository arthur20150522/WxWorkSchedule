"""Quick sanity tests for the @-mention send helpers in bridge.py."""
import bridge


def test_parse_segments():
    cases = [
        ('@张三 开会了', [('at', '张三'), ('text', ' 开会了')]),
        ('提醒 @张三 和 @李四 明天值班',
         [('text', '提醒 '), ('at', '张三'), ('text', ' 和 '), ('at', '李四'), ('text', ' 明天值班')]),
        ('no mention here', [('text', 'no mention here')]),
        ('price is 100@163.com', [('text', 'price is 100'), ('at', '163.com')]),
        ('@所有人 请查收', [('at', '所有人'), ('text', ' 请查收')]),
        ('trailing @', [('text', 'trailing @')]),
        ('@a@b', [('at', 'a'), ('at', 'b')]),
        ('', []),
        ('@张三，@李四。收到',
         [('at', '张三'), ('text', '，'), ('at', '李四'), ('text', '。收到')]),
    ]
    for msg, expected in cases:
        got = bridge._parse_at_segments(msg)
        assert got == expected, f'{msg!r}: got {got}'
    print('parse_segments: OK')


def test_sendkeys_escape():
    class FakeEdit:
        def __init__(self):
            self.keys = []

        def SendKeys(self, k):
            self.keys.append(k)

    e = FakeEdit()
    bridge._sendkeys_literal(e, '张三(x) {y}')
    assert e.keys == ['张三{(}x{)} {{}y{}}'], e.keys
    e2 = FakeEdit()
    bridge._sendkeys_literal(e2, '普通昵称123')
    assert e2.keys == ['普通昵称123'], e2.keys
    print('sendkeys_escape: OK')


if __name__ == '__main__':
    test_parse_segments()
    test_sendkeys_escape()
    print('ALL TESTS PASS')
