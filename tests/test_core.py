import json
import math
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import hat_core as h


class KeyframeTests(unittest.TestCase):
    def test_piecewise_easing(self):
        for ease in ('smooth', 'linear', 'hold'):
            keys=[{'t':0,'v':0,'ease':ease},{'t':1,'v':1,'ease':'smooth'}]
            self.assertEqual(h.interpolate(keys,-1,0),0)
            self.assertEqual(h.interpolate(keys,2,0),1)
            midpoint=h.interpolate(keys,.5,0)
            self.assertEqual(midpoint, 0 if ease=='hold' else .5)
        smooth=[{'t':0,'v':0,'ease':'smooth'},{'t':1,'v':1,'ease':'smooth'}]
        self.assertLess(h.interpolate(smooth,.25,0), .25)

    def test_clip_validation(self):
        clip=h.clip_template('intro','Intro')
        clip['tracks']['jaw']=[{'t':.7,'v':1,'ease':'linear'},{'t':.3,'v':-1,'ease':'wrong'}]
        cleaned=h.validate_clip(clip,'intro')
        self.assertEqual(cleaned['tracks']['jaw'][0],{'t':.3,'v':0,'ease':'smooth'})
        self.assertEqual(cleaned['tracks']['jaw'][1]['v'],1)
        clip['audio']='../../evil.wav'
        with self.assertRaises(ValueError):h.validate_clip(clip,'intro')

    def test_settings_rejects_i2s_and_button_collision(self):
        s=h.initial_settings()
        for pin in (18,19,21,22):
            s['jaw']['gpio']=pin
            with self.assertRaises(ValueError):h.validate_settings(s)
        s=h.initial_settings();s['jaw']['max_us']=2500
        with self.assertRaises(ValueError):h.validate_settings(s)

    def test_servo_normalized_limit(self):
        s=h.initial_settings();d=h.ServoOutput(False,s)
        d.set('jaw',0);self.assertEqual(d.last['jaw'],1200)
        d.set('jaw',1);self.assertEqual(d.last['jaw'],1750)
        d.set('jaw',123);self.assertEqual(d.last['jaw'],1750)


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.dir=Path(self.temp.name)
        self.patchers=[mock.patch.object(h,'AUDIO',self.dir/'audio'),
                       mock.patch.object(h,'PROJECT_FILE',self.dir/'project.json'),
                       mock.patch.object(h,'SETTINGS_FILE',self.dir/'settings.json')]
        for p in self.patchers:p.start()
        self.engine=h.HatEngine(hardware=False)

    def tearDown(self):
        self.engine.close()
        for p in reversed(self.patchers):p.stop()
        self.temp.cleanup()

    def test_initial_project_and_save(self):
        self.assertEqual(len(self.engine.get_project()['clips']),1)
        c=self.engine.get_project()['clips'][0]
        c['title']='Custom greeting'
        self.engine.save_clip(c['id'],c)
        self.assertEqual(self.engine.get_project()['clips'][0]['title'],'Custom greeting')
        self.assertTrue((self.dir/'project.json').exists())

    def test_single_clip_playback(self):
        self.assertTrue(self.engine.start_clip('performance_1'))
        self.assertFalse(self.engine.start_clip('performance_1'))
        self.engine.stop()
        deadline=time.monotonic()+2
        while self.engine.status()['busy'] and time.monotonic()<deadline:time.sleep(.02)
        self.assertFalse(self.engine.status()['busy'])

    def test_manual_preview(self):
        self.assertTrue(self.engine.preview(.3,.6))
        time.sleep(.075)
        pulses=self.engine.status()['servo_pulses']
        self.assertIsNotNone(pulses['jaw'])
        self.assertIsNotNone(pulses['brow'])


if __name__ == '__main__':unittest.main()
