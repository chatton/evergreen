// +build windows

package jasper

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/satori/go.uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func makeTracker() (*windowsProcessTracker, error) {
	tracker, err := NewProcessTracker("foo" + uuid.Must(uuid.NewV4()).String())
	if err != nil {
		return nil, err
	}

	windowsTracker, ok := tracker.(*windowsProcessTracker)
	if !ok {
		return nil, errors.New("not a Windows process tracker")
	}
	return windowsTracker, nil
}

func TestWindowsProcessTracker(t *testing.T) {
	for testName, testCase := range map[string]func(context.Context, *testing.T, *windowsProcessTracker, *CreateOptions){
		"NewWindowsProcessTrackerCreatesJob": func(_ context.Context, t *testing.T, tracker *windowsProcessTracker, opts *CreateOptions) {
			require.NotNil(t, tracker.job)
			info, err := QueryInformationJobObjectProcessIdList(tracker.job.handle)
			assert.NoError(t, err)
			assert.Equal(t, 0, int(info.NumberOfAssignedProcesses))
		},
		"AddProcessToTrackerAssignsPID": func(ctx context.Context, t *testing.T, tracker *windowsProcessTracker, opts *CreateOptions) {
			opts1, opts2 := opts, opts.Copy()
			proc1, err := newBasicProcess(ctx, opts1)
			require.NoError(t, err)
			assert.NoError(t, tracker.Add(proc1.Info(ctx)))

			proc2, err := newBasicProcess(ctx, opts2)
			require.NoError(t, err)
			assert.NoError(t, tracker.Add(proc2.Info(ctx)))

			info, err := QueryInformationJobObjectProcessIdList(tracker.job.handle)
			assert.NoError(t, err)
			assert.Equal(t, 2, int(info.NumberOfAssignedProcesses))
			assert.Contains(t, info.ProcessIdList, uint64(proc1.Info(ctx).PID))
			assert.Contains(t, info.ProcessIdList, uint64(proc2.Info(ctx).PID))
		},
		"AddedProcessIsTerminatedOnCleanup": func(ctx context.Context, t *testing.T, tracker *windowsProcessTracker, opts *CreateOptions) {
			proc, err := newBasicProcess(ctx, opts)
			require.NoError(t, err)

			assert.NoError(t, tracker.Add(proc.Info(ctx)))

			info, err := QueryInformationJobObjectProcessIdList(tracker.job.handle)
			assert.NoError(t, err)
			assert.Equal(t, 1, int(info.NumberOfAssignedProcesses))
			assert.Contains(t, info.ProcessIdList, uint64(proc.Info(ctx).PID))

			assert.NoError(t, tracker.Cleanup())

			exitCode, err := proc.Wait(ctx)
			assert.Zero(t, exitCode)
			assert.NoError(t, err)
			assert.Nil(t, ctx.Err())
			assert.True(t, proc.Complete(ctx))
		},
		"CleanupWithNoProcessesDoesNotError": func(ctx context.Context, t *testing.T, tracker *windowsProcessTracker, opts *CreateOptions) {
			assert.NoError(t, tracker.Cleanup())
		},
		"DoubleCleanupDoesNotError": func(ctx context.Context, t *testing.T, tracker *windowsProcessTracker, opts *CreateOptions) {
			proc, err := newBasicProcess(ctx, opts)
			require.NoError(t, err)

			assert.NoError(t, tracker.Add(proc.Info(ctx)))

			info, err := QueryInformationJobObjectProcessIdList(tracker.job.handle)
			assert.NoError(t, err)
			assert.Equal(t, 1, int(info.NumberOfAssignedProcesses))
			assert.Contains(t, info.ProcessIdList, uint64(proc.Info(ctx).PID))

			assert.NoError(t, tracker.Cleanup())
			assert.NoError(t, tracker.Cleanup())

			exitCode, err := proc.Wait(ctx)
			assert.Zero(t, exitCode)
			assert.NoError(t, err)
			assert.Nil(t, ctx.Err())
			assert.True(t, proc.Complete(ctx))
		},
		"CanAddProcessAfterCleanup": func(ctx context.Context, t *testing.T, tracker *windowsProcessTracker, opts *CreateOptions) {
			assert.NoError(t, tracker.Cleanup())

			proc, err := newBasicProcess(ctx, opts)
			require.NoError(t, err)

			assert.NoError(t, tracker.Add(proc.Info(ctx)))
			info, err := QueryInformationJobObjectProcessIdList(tracker.job.handle)
			assert.NoError(t, err)
			assert.Equal(t, 1, int(info.NumberOfAssignedProcesses))
		},
		// "": func(ctx context.Context, t *testing.T, tracker *windowsProcessTracker) {},
	} {
		t.Run(testName, func(t *testing.T) {
			if _, runningInEvgAgent := os.LookupEnv("EVR_TASK_ID"); runningInEvgAgent {
				t.Skip("Evergreen makes its own job object, so these will not pass in Evergreen tests ",
					"(although they will pass if locally run).")
			}
			ctx, cancel := context.WithTimeout(context.Background(), taskTimeout)
			defer cancel()

			tracker, err := makeTracker()
			defer func() {
				assert.NoError(t, tracker.Cleanup())
			}()
			require.NoError(t, err)
			require.NotNil(t, tracker)
			opts := yesCreateOpts(taskTimeout)

			testCase(ctx, t, tracker, &opts)
		})
	}
}
